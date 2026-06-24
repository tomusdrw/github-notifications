import { Octokit } from "octokit";
import type { NotificationThread } from "./types.js";

export function createOctokit(token: string): Octokit {
  return new Octokit({
    auth: token,
    throttle: {
      enabled: true,
      onRateLimit: (
        _retryAfter: number,
        _opts: unknown,
        _octokit: unknown,
        retryCount: number,
      ): boolean => retryCount < 1,
      onSecondaryRateLimit: (
        _retryAfter: number,
        _opts: unknown,
        _octokit: unknown,
        retryCount: number,
      ): boolean => retryCount < 1,
    },
  });
}

export async function fetchNotifications(octokit: Octokit): Promise<NotificationThread[]> {
  const threads = (await octokit.paginate("GET /notifications", {
    per_page: 50,
  })) as unknown as NotificationThread[];
  return threads.filter((t) => t.unread === true);
}

export async function markThreadDone(octokit: Octokit, threadId: string): Promise<void> {
  await octokit.request("DELETE /notifications/threads/{thread_id}", {
    thread_id: Number(threadId),
  });
}

export class FetchError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "FetchError";
    this.statusCode = statusCode;
  }
}
