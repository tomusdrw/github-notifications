import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Octokit } from "octokit";
import pino from "pino";
import {
  fetchUserIssues,
  filterIssues,
  applyLimit,
  formatItems,
} from "../src/list.js";
import type { IssueListItem } from "../src/types.js";

const silentLogger = pino({ level: "silent" });

function makeOctokitWithData(data: unknown[]): Pick<Octokit, "paginate"> {
  return { paginate: vi.fn().mockResolvedValue(data) } as unknown as Pick<
    Octokit,
    "paginate"
  >;
}

function makeItem(overrides: Partial<IssueListItem> = {}): IssueListItem {
  return {
    number: 1,
    title: "Default title",
    state: "open",
    html_url: "https://github.com/owner/repo/issues/1",
    repository_full_name: "owner/repo",
    updated_at: "2026-07-04T12:00:00Z",
    kind: "issue",
    ...overrides,
  };
}

describe("fetchUserIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps raw issues to IssueListItem with kind=issue when no pull_request", async () => {
    const octokit = makeOctokitWithData([
      {
        number: 42,
        title: "Bug",
        state: "open",
        html_url: "https://github.com/owner/repo/issues/42",
        repository_url: "https://api.github.com/repos/owner/repo",
        updated_at: "2026-07-04T12:00:00Z",
      },
    ]);
    const items = await fetchUserIssues(
      octokit as unknown as Octokit,
      "assigned",
      "open",
      silentLogger,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      number: 42,
      title: "Bug",
      state: "open",
      html_url: "https://github.com/owner/repo/issues/42",
      repository_full_name: "owner/repo",
      updated_at: "2026-07-04T12:00:00Z",
      kind: "issue",
    });
  });

  it("maps pull_request field to kind=pull_request", async () => {
    const octokit = makeOctokitWithData([
      {
        number: 7,
        title: "PR",
        state: "open",
        html_url: "https://github.com/owner/repo/pull/7",
        repository_url: "https://api.github.com/repos/owner/repo",
        updated_at: "2026-07-04T12:00:00Z",
        pull_request: { url: "x" },
      },
    ]);
    const items = await fetchUserIssues(
      octokit as unknown as Octokit,
      "mentioned",
      "open",
      silentLogger,
    );
    expect(items[0].kind).toBe("pull_request");
  });

  it("passes filter and state to the API", async () => {
    const paginate = vi.fn().mockResolvedValue([]);
    const octokit = { paginate } as unknown as Octokit;
    await fetchUserIssues(octokit, "mentioned", "closed", silentLogger);
    expect(paginate).toHaveBeenCalledWith("GET /issues", {
      filter: "mentioned",
      state: "closed",
      per_page: 50,
    });
  });

  it("parses repo full name from repository_url", async () => {
    const octokit = makeOctokitWithData([
      {
        number: 1,
        title: "x",
        state: "open",
        html_url: "u",
        repository_url: "https://api.github.com/repos/acme/widget",
        updated_at: "t",
      },
    ]);
    const items = await fetchUserIssues(
      octokit as unknown as Octokit,
      "assigned",
      "open",
      silentLogger,
    );
    expect(items[0].repository_full_name).toBe("acme/widget");
  });

  it("falls back to raw url when repo pattern doesn't match", async () => {
    const octokit = makeOctokitWithData([
      {
        number: 1,
        title: "x",
        state: "open",
        html_url: "u",
        repository_url: "https://example.com/whatever",
        updated_at: "t",
      },
    ]);
    const items = await fetchUserIssues(
      octokit as unknown as Octokit,
      "assigned",
      "open",
      silentLogger,
    );
    expect(items[0].repository_full_name).toBe("https://example.com/whatever");
  });
});

describe("filterIssues", () => {
  const items: IssueListItem[] = [
    makeItem({ number: 1, kind: "issue" }),
    makeItem({ number: 2, kind: "pull_request" }),
    makeItem({ number: 3, kind: "issue" }),
  ];

  it("excludes pull requests by default", () => {
    expect(filterIssues(items, false).map((i) => i.number)).toEqual([1, 3]);
  });

  it("includes pull requests when includePrs=true", () => {
    expect(filterIssues(items, true).map((i) => i.number)).toEqual([1, 2, 3]);
  });
});

describe("applyLimit", () => {
  const items: IssueListItem[] = [
    makeItem({ number: 1 }),
    makeItem({ number: 2 }),
    makeItem({ number: 3 }),
    makeItem({ number: 4 }),
  ];

  it("returns all when limit is undefined", () => {
    expect(applyLimit(items, undefined)).toHaveLength(4);
  });

  it("returns all when limit is 0 or negative", () => {
    expect(applyLimit(items, 0)).toHaveLength(4);
    expect(applyLimit(items, -1)).toHaveLength(4);
  });

  it("returns all when limit is NaN", () => {
    expect(applyLimit(items, NaN)).toHaveLength(4);
  });

  it("caps to the requested count", () => {
    expect(applyLimit(items, 2).map((i) => i.number)).toEqual([1, 2]);
  });
});

describe("formatItems", () => {
  it("returns 'No items found.' for empty input in text mode", () => {
    expect(formatItems([], false)).toBe("No items found.");
  });

  it("formats each item as 'repo #N [state/kind] title\\n  url'", () => {
    const items: IssueListItem[] = [
      makeItem({
        number: 42,
        title: "Bug",
        state: "open",
        kind: "issue",
        repository_full_name: "owner/repo",
        html_url: "https://github.com/owner/repo/issues/42",
      }),
      makeItem({
        number: 7,
        title: "PR",
        state: "closed",
        kind: "pull_request",
        repository_full_name: "owner/repo",
        html_url: "https://github.com/owner/repo/pull/7",
      }),
    ];
    const out = formatItems(items, false);
    expect(out).toBe(
      [
        "owner/repo #42 [open/Issue] Bug",
        "  https://github.com/owner/repo/issues/42",
        "owner/repo #7 [closed/PR] PR",
        "  https://github.com/owner/repo/pull/7",
      ].join("\n"),
    );
  });

  it("emits a JSON array when asJson=true", () => {
    const items: IssueListItem[] = [makeItem({ number: 5 })];
    const parsed = JSON.parse(formatItems(items, true));
    expect(parsed).toEqual(items);
  });

  it("emits '[]' in JSON mode for empty input", () => {
    expect(JSON.parse(formatItems([], true))).toEqual([]);
  });
});
