import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pino from "pino";
import type { Octokit } from "octokit";
import type { NotificationThread } from "../src/types.js";

vi.mock("../src/github-client.js", () => ({
  fetchNotifications: vi.fn(),
  markThreadDone: vi.fn(),
}));

vi.mock("../src/hydrate.js", () => ({
  hydrateSubject: vi.fn(),
}));

vi.mock("../src/feed-file.js", () => ({
  appendRecord: vi.fn(),
}));

import { captureAll } from "../src/capture.js";
import { fetchNotifications, markThreadDone } from "../src/github-client.js";
import { hydrateSubject } from "../src/hydrate.js";
import { appendRecord } from "../src/feed-file.js";

const silentLogger = pino({ level: "silent" });

const TEST_DIR = join(tmpdir(), `gh-capture-test-${Date.now()}`);

function makeThread(id: string): NotificationThread {
  return {
    id,
    repository: {
      id: 1,
      node_id: "n",
      name: "repo",
      full_name: "owner/repo",
      owner: { login: "owner", id: 1 },
      html_url: "https://github.com/owner/repo",
    },
    subject: {
      title: `Thread ${id}`,
      url: `https://api.github.com/repos/owner/repo/issues/${id}`,
      latest_comment_url: `https://api.github.com/repos/owner/repo/issues/comments/${id}`,
      type: "Issue",
    },
    reason: "mention",
    unread: true,
    updated_at: "2026-06-24T12:00:00Z",
    last_read_at: null,
    url: `https://api.github.com/notifications/threads/${id}`,
    subscription_url: "https://api.github.com/notifications/threads/sub",
  };
}

describe("captureAll", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("happy path: 3 threads all succeed", async () => {
    const threads = [makeThread("1"), makeThread("2"), makeThread("3")];
    vi.mocked(fetchNotifications).mockResolvedValue(threads);
    vi.mocked(hydrateSubject).mockResolvedValue({ subject_body: "body", comment_body: null, hydrated: true });
    vi.mocked(appendRecord).mockResolvedValue(undefined);
    vi.mocked(markThreadDone).mockResolvedValue(undefined);

    const outputPath = join(TEST_DIR, "feed.jsonl");
    const summary = await captureAll({} as Octokit, outputPath, silentLogger);

    expect(summary).toEqual({ captured: 3, skipped: 0, failed: 0 });
    expect(appendRecord).toHaveBeenCalledTimes(3);
    expect(markThreadDone).toHaveBeenCalledTimes(3);
  });

  it("hydration failure on middle thread (R8): others still captured", async () => {
    const threads = [makeThread("1"), makeThread("2"), makeThread("3")];
    vi.mocked(fetchNotifications).mockResolvedValue(threads);
    vi.mocked(hydrateSubject)
      .mockResolvedValueOnce({ subject_body: "body1", comment_body: null, hydrated: true })
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({ subject_body: "body3", comment_body: null, hydrated: true });
    vi.mocked(appendRecord).mockResolvedValue(undefined);
    vi.mocked(markThreadDone).mockResolvedValue(undefined);

    const outputPath = join(TEST_DIR, "feed.jsonl");
    const summary = await captureAll({} as Octokit, outputPath, silentLogger);

    expect(summary.captured).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(0);
    expect(markThreadDone).toHaveBeenCalledTimes(2);
  });

  it("file write failure on middle thread (R6/R7): mark-done skipped", async () => {
    const threads = [makeThread("1"), makeThread("2"), makeThread("3")];
    vi.mocked(fetchNotifications).mockResolvedValue(threads);
    vi.mocked(hydrateSubject).mockResolvedValue({ subject_body: "body", comment_body: null, hydrated: true });
    vi.mocked(appendRecord)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("EACCES"))
      .mockResolvedValueOnce(undefined);
    vi.mocked(markThreadDone).mockResolvedValue(undefined);

    const outputPath = join(TEST_DIR, "feed.jsonl");
    const summary = await captureAll({} as Octokit, outputPath, silentLogger);

    expect(summary.captured).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(0);
    expect(markThreadDone).toHaveBeenCalledTimes(2);
  });

  it("mark-done failure: record in file, thread stays in inbox", async () => {
    const threads = [makeThread("1"), makeThread("2"), makeThread("3")];
    vi.mocked(fetchNotifications).mockResolvedValue(threads);
    vi.mocked(hydrateSubject).mockResolvedValue({ subject_body: "body", comment_body: null, hydrated: true });
    vi.mocked(appendRecord).mockResolvedValue(undefined);
    vi.mocked(markThreadDone)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValueOnce(undefined);

    const outputPath = join(TEST_DIR, "feed.jsonl");
    const summary = await captureAll({} as Octokit, outputPath, silentLogger);

    expect(summary.captured).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(appendRecord).toHaveBeenCalledTimes(3);
  });

  it("top-level fetch failure (401): exits non-zero, zero processed", async () => {
    const error = new Error("Bad credentials") as Error & { status: number };
    error.status = 401;
    vi.mocked(fetchNotifications).mockRejectedValue(error);

    const outputPath = join(TEST_DIR, "feed.jsonl");
    const summary = await captureAll({} as Octokit, outputPath, silentLogger);

    expect(summary).toEqual({ captured: 0, skipped: 0, failed: 0 });
    expect(appendRecord).not.toHaveBeenCalled();
    expect(markThreadDone).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("top-level fetch failure (network): exits non-zero", async () => {
    vi.mocked(fetchNotifications).mockRejectedValue(new Error("ECONNREFUSED"));

    const outputPath = join(TEST_DIR, "feed.jsonl");
    const summary = await captureAll({} as Octokit, outputPath, silentLogger);

    expect(summary).toEqual({ captured: 0, skipped: 0, failed: 0 });
    expect(process.exitCode).toBe(1);
  });

  it("empty inbox: exits cleanly with 0 notifications", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue([]);

    const outputPath = join(TEST_DIR, "feed.jsonl");
    const summary = await captureAll({} as Octokit, outputPath, silentLogger);

    expect(summary).toEqual({ captured: 0, skipped: 0, failed: 0 });
    expect(hydrateSubject).not.toHaveBeenCalled();
    expect(appendRecord).not.toHaveBeenCalled();
  });
});

// Import afterEach for cleanup
import { afterEach } from "vitest";
