import type { Octokit } from "octokit";
import type { Logger } from "pino";
import type { IssueListItem } from "./types.js";

export type IssueFilter = "assigned" | "mentioned";
export type IssueState = "open" | "closed" | "all";

interface RawIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  repository_url: string;
  updated_at: string;
  pull_request?: unknown;
}

function parseRepoFullName(repositoryUrl: string): string {
  const match = /\/repos\/([^/]+\/[^/]+)$/.exec(repositoryUrl);
  return match ? match[1] : repositoryUrl;
}

export async function fetchUserIssues(
  octokit: Octokit,
  filter: IssueFilter,
  state: IssueState,
  logger: Logger,
): Promise<IssueListItem[]> {
  const items = (await octokit.paginate("GET /issues", {
    filter,
    state,
    per_page: 50,
  })) as unknown as RawIssue[];

  logger.debug({ filter, state, count: items.length }, "Fetched issues");

  return items.map((item) => ({
    number: item.number,
    title: item.title,
    state: item.state,
    html_url: item.html_url,
    repository_full_name: parseRepoFullName(item.repository_url),
    updated_at: item.updated_at,
    kind: item.pull_request !== undefined ? "pull_request" : "issue",
  }));
}

export function filterIssues(
  items: IssueListItem[],
  includePrs: boolean,
): IssueListItem[] {
  return includePrs ? items : items.filter((i) => i.kind === "issue");
}

export function applyLimit(
  items: IssueListItem[],
  limit: number | undefined,
): IssueListItem[] {
  if (limit === undefined || limit <= 0 || !Number.isFinite(limit)) return items;
  return items.slice(0, limit);
}

export function formatItems(items: IssueListItem[], asJson: boolean): string {
  if (asJson) {
    return JSON.stringify(items, null, 2);
  }
  if (items.length === 0) return "No items found.";
  return items
    .map((it) => {
      const kind = it.kind === "pull_request" ? "PR" : "Issue";
      return `${it.repository_full_name} #${it.number} [${it.state}/${kind}] ${it.title}\n  ${it.html_url}`;
    })
    .join("\n");
}
