import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, stat, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendRecord } from "../src/feed-file.js";
import type { FeedRecord } from "../src/types.js";

const TEST_DIR = join(tmpdir(), `gh-feed-test-${Date.now()}`);

function makeRecord(id: string): FeedRecord {
  return {
    id,
    captured_at: new Date("2026-06-24T12:00:00Z").toISOString(),
    reason: "mention",
    subject_type: "Issue",
    title: `Test ${id}`,
    repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
    subject_url: "https://api.github.com/repos/owner/repo/issues/1",
    latest_comment_url: "https://api.github.com/repos/owner/repo/issues/comments/1",
    subject_content: "Body text",
    latest_comment_content: "Comment text",
    hydrated: true,
  };
}

describe("appendRecord", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    return rm(TEST_DIR, { recursive: true, force: true });
  });

  it("creates file with one line when it doesn't exist", async () => {
    const path = join(TEST_DIR, "feed.jsonl");
    await appendRecord(path, makeRecord("1"));
    const content = await readFile(path, "utf-8");
    expect(content.trim()).toBe(JSON.stringify(makeRecord("1")));
  });

  it("appends to existing file without touching existing lines", async () => {
    const path = join(TEST_DIR, "feed.jsonl");
    await appendRecord(path, makeRecord("1"));
    await appendRecord(path, makeRecord("2"));
    const content = await readFile(path, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe("1");
    expect(JSON.parse(lines[1]).id).toBe("2");
  });

  it("each line is independently parseable JSON", async () => {
    const path = join(TEST_DIR, "feed.jsonl");
    await appendRecord(path, makeRecord("1"));
    await appendRecord(path, makeRecord("2"));
    await appendRecord(path, makeRecord("3"));
    const content = await readFile(path, "utf-8");
    const lines = content.trim().split("\n");
    const records = lines.map((line) => JSON.parse(line));
    expect(records).toHaveLength(3);
    expect(records[0].id).toBe("1");
    expect(records[2].id).toBe("3");
  });

  it("preserves unicode and special characters", async () => {
    const path = join(TEST_DIR, "feed.jsonl");
    const record = makeRecord("1");
    record.subject_content = "Hello 世界 🌍 — \"quotes\" & <html>";
    await appendRecord(path, record);
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.subject_content).toBe("Hello 世界 🌍 — \"quotes\" & <html>");
  });

  it("handles large content (10KB body)", async () => {
    const path = join(TEST_DIR, "feed.jsonl");
    const record = makeRecord("1");
    record.subject_content = "x".repeat(10_000);
    await appendRecord(path, record);
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.subject_content).toHaveLength(10_000);
  });

  it("creates file with mode 0o600 on first creation", async () => {
    const path = join(TEST_DIR, "feed.jsonl");
    await appendRecord(path, makeRecord("1"));
    const stats = await stat(path);
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
