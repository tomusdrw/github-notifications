import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Octokit } from "octokit";
import { hydrateSubject } from "../src/hydrate.js";
import type { NotificationThread } from "../src/types.js";

function makeThread(type: string, opts?: { subjectUrl?: string; latestCommentUrl?: string }): NotificationThread {
  const subjectUrl = opts?.subjectUrl ?? `https://api.github.com/repos/owner/repo/issues/1`;
  return {
    id: "123",
    repository: {
      id: 1,
      node_id: "n",
      name: "repo",
      full_name: "owner/repo",
      owner: { login: "owner", id: 1 },
      html_url: "https://github.com/owner/repo",
    },
    subject: {
      title: "Test",
      url: subjectUrl,
      latest_comment_url: opts?.latestCommentUrl ?? subjectUrl,
      type,
    },
    reason: "mention",
    unread: true,
    updated_at: "2026-06-24T12:00:00Z",
    last_read_at: null,
    url: "https://api.github.com/notifications/threads/123",
    subscription_url: "https://api.github.com/notifications/threads/123/subscription",
  };
}

function makeMockOctokit(): Octokit {
  return {
    request: vi.fn(),
  } as unknown as Octokit;
}

describe("hydrateSubject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates Issue with distinct latest_comment_url (body + comment)", async () => {
    const octokit = makeMockOctokit();
    (octokit.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { body: "Issue body text" } })
      .mockResolvedValueOnce({ data: { body: "Comment text" } });

    const thread = makeThread("Issue", {
      latestCommentUrl: "https://api.github.com/repos/owner/repo/issues/comments/5",
    });
    const result = await hydrateSubject(thread, octokit);

    expect(result.hydrated).toBe(true);
    expect(result.subject_body).toBe("Issue body text");
    expect(result.comment_body).toBe("Comment text");
    expect(octokit.request).toHaveBeenCalledTimes(2);
  });

  it("hydrates Issue where subject.url === latest_comment_url (single fetch)", async () => {
    const octokit = makeMockOctokit();
    (octokit.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { body: "Issue body only" },
    });

    const thread = makeThread("Issue");
    const result = await hydrateSubject(thread, octokit);

    expect(result.hydrated).toBe(true);
    expect(result.subject_body).toBe("Issue body only");
    expect(result.comment_body).toBeNull();
    expect(octokit.request).toHaveBeenCalledTimes(1);
  });

  it("hydrates PullRequest", async () => {
    const octokit = makeMockOctokit();
    (octokit.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { body: "PR description" },
    });

    const thread = makeThread("PullRequest");
    const result = await hydrateSubject(thread, octokit);

    expect(result.hydrated).toBe(true);
    expect(result.subject_body).toBe("PR description");
  });

  it("hydrates Commit (uses message field)", async () => {
    const octokit = makeMockOctokit();
    (octokit.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { commit: { message: "Fix the bug" } },
    });

    const thread = makeThread("Commit");
    const result = await hydrateSubject(thread, octokit);

    expect(result.hydrated).toBe(true);
    expect(result.subject_body).toContain("Fix the bug");
  });

  it("hydrates Release", async () => {
    const octokit = makeMockOctokit();
    (octokit.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { body: "Release notes here" },
    });

    const thread = makeThread("Release");
    const result = await hydrateSubject(thread, octokit);

    expect(result.hydrated).toBe(true);
    expect(result.subject_body).toBe("Release notes here");
  });

  it("returns envelope-only for Discussion (no fetch attempted)", async () => {
    const octokit = makeMockOctokit();
    const thread = makeThread("Discussion");
    const result = await hydrateSubject(thread, octokit);

    expect(result.hydrated).toBe(false);
    expect(result.subject_body).toBeNull();
    expect(octokit.request).not.toHaveBeenCalled();
  });

  it("returns envelope-only for CheckSuite/WorkflowRun", async () => {
    const octokit = makeMockOctokit();
    const thread = makeThread("WorkflowRun");
    const result = await hydrateSubject(thread, octokit);

    expect(result.hydrated).toBe(false);
    expect(octokit.request).not.toHaveBeenCalled();
  });

  it("returns envelope-only for unknown type", async () => {
    const octokit = makeMockOctokit();
    const thread = makeThread("SomeNewType");
    const result = await hydrateSubject(thread, octokit);

    expect(result.hydrated).toBe(false);
    expect(octokit.request).not.toHaveBeenCalled();
  });

  it("throws on 404 (deleted subject)", async () => {
    const octokit = makeMockOctokit();
    const error = new Error("Not Found") as Error & { status: 404 };
    (octokit.request as ReturnType<typeof vi.fn>).mockRejectedValue(error);

    const thread = makeThread("Issue");
    await expect(hydrateSubject(thread, octokit)).rejects.toThrow("Not Found");
  });

  it("handles null latest_comment_url (fetches subject only)", async () => {
    const octokit = makeMockOctokit();
    (octokit.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { body: "Subject body" },
    });

    const thread = makeThread("Issue", { latestCommentUrl: "" });
    const result = await hydrateSubject(thread, octokit);

    expect(result.hydrated).toBe(true);
    expect(result.subject_body).toBe("Subject body");
    expect(result.comment_body).toBeNull();
    expect(octokit.request).toHaveBeenCalledTimes(1);
  });
});
