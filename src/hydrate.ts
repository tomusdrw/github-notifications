import type { Octokit } from "octokit";
import type { NotificationThread, HydrationResult } from "./types.js";

const HYDRATED_TYPES = new Set([
  "Issue",
  "PullRequest",
  "Commit",
  "Release",
  "RepositoryVulnerabilityAlert",
]);

export async function hydrateSubject(
  thread: NotificationThread,
  octokit: Octokit,
): Promise<HydrationResult> {
  const subjectType = thread.subject.type;

  if (!HYDRATED_TYPES.has(subjectType)) {
    return { subject_body: null, comment_body: null, hydrated: false };
  }

  const subjectBody = await fetchUrl(octokit, thread.subject.url);

  let commentBody: string | null = null;
  const latestCommentUrl = thread.subject.latest_comment_url;
  if (latestCommentUrl && latestCommentUrl !== thread.subject.url) {
    commentBody = await fetchUrl(octokit, latestCommentUrl);
  }

  return { subject_body: subjectBody, comment_body: commentBody, hydrated: true };
}

async function fetchUrl(octokit: Octokit, url: string): Promise<string> {
  const response = await octokit.request(`GET ${url}`);
  const data = response.data as Record<string, unknown>;
  return extractContent(data);
}

function extractContent(data: Record<string, unknown>): string {
  if (typeof data.body === "string") {
    return data.body;
  }
  if (typeof data.message === "string") {
    return data.message;
  }
  if (typeof data.summary === "string") {
    return data.summary;
  }
  if (
    typeof data.commit === "object" &&
    data.commit !== null &&
    typeof (data.commit as Record<string, unknown>).message === "string"
  ) {
    return (data.commit as Record<string, unknown>).message as string;
  }
  return JSON.stringify(data);
}
