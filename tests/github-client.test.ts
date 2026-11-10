import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOctokit, fetchNotifications, markThreadDone } from "../src/github-client.js";

vi.mock("octokit", () => {
  function createMockOctokit(paginateData: unknown[] = [], requestResponse?: unknown) {
    return {
      paginate: vi.fn().mockResolvedValue(paginateData),
      request: requestResponse ? vi.fn().mockResolvedValue(requestResponse) : vi.fn(),
      hook: { wrap: vi.fn() },
      auth: vi.fn(),
      graphql: vi.fn(),
      rest: {},
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
  }
  return {
    Octokit: vi.fn(function (opts) {
      const instance = createMockOctokit();
      return { ...instance, _opts: opts };
    }),
    createMockOctokit,
  };
});

describe("createOctokit", () => {
  it("constructs an Octokit instance with auth and throttle config", () => {
    const octokit = createOctokit("fake-token");
    expect(octokit).toBeDefined();
    expect(octokit.paginate).toBeDefined();
  });
});

describe("fetchNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all unread threads", async () => {
    const octokit = createOctokit("token");
    octokit.paginate = vi.fn().mockResolvedValue([
      { id: "1", unread: true, subject: { type: "Issue" } },
      { id: "2", unread: true, subject: { type: "PullRequest" } },
    ]);
    const threads = await fetchNotifications(octokit);
    expect(threads).toHaveLength(2);
  });

  it("filters out read (unread=false) threads", async () => {
    const octokit = createOctokit("token");
    octokit.paginate = vi.fn().mockResolvedValue([
      { id: "1", unread: true },
      { id: "2", unread: false },
      { id: "3", unread: true },
    ]);
    const threads = await fetchNotifications(octokit);
    expect(threads).toHaveLength(2);
    expect(threads.map((t) => t.id)).toEqual(["1", "3"]);
  });

  it("paginates across pages (>50 unread)", async () => {
    const octokit = createOctokit("token");
    const bigData = Array.from({ length: 60 }, (_, i) => ({
      id: String(i + 1),
      unread: true,
      subject: { type: "Issue" },
    }));
    octokit.paginate = vi.fn().mockResolvedValue(bigData);
    const threads = await fetchNotifications(octokit);
    expect(threads).toHaveLength(60);
  });

  it("returns empty array for empty inbox", async () => {
    const octokit = createOctokit("token");
    octokit.paginate = vi.fn().mockResolvedValue([]);
    const threads = await fetchNotifications(octokit);
    expect(threads).toEqual([]);
  });

  it("throws on 401 (invalid token)", async () => {
    const octokit = createOctokit("token");
    const error = new Error("Bad credentials") as Error & { status: 401 };
    octokit.paginate = vi.fn().mockRejectedValue(error);
    await expect(fetchNotifications(octokit)).rejects.toThrow("Bad credentials");
  });

  it("throws on 403 (wrong scope)", async () => {
    const octokit = createOctokit("token");
    const error = new Error("Forbidden") as Error & { status: 403 };
    octokit.paginate = vi.fn().mockRejectedValue(error);
    await expect(fetchNotifications(octokit)).rejects.toThrow("Forbidden");
  });

  it("throws on network error", async () => {
    const octokit = createOctokit("token");
    octokit.paginate = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(fetchNotifications(octokit)).rejects.toThrow("ECONNREFUSED");
  });
});

describe("markThreadDone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls DELETE with the correct thread ID", async () => {
    const octokit = createOctokit("token");
    octokit.request = vi.fn().mockResolvedValue({ status: 204 });
    await markThreadDone(octokit, "12345");
    expect(octokit.request).toHaveBeenCalledWith(
      "DELETE /notifications/threads/{thread_id}",
      { thread_id: 12345 },
    );
  });
});
