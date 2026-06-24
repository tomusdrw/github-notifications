import type { Octokit } from "octokit";
import type { Logger } from "pino";
import { fetchNotifications, markThreadDone } from "./github-client.js";
import { hydrateSubject } from "./hydrate.js";
import { appendRecord } from "./feed-file.js";
import type { FeedRecord, NotificationThread } from "./types.js";

export interface RunSummary {
  captured: number;
  skipped: number;
  failed: number;
}

export async function captureAll(
  octokit: Octokit,
  outputPath: string,
  logger: Logger,
): Promise<RunSummary> {
  let threads: NotificationThread[];
  try {
    threads = await fetchNotifications(octokit);
  } catch (err) {
    const statusCode = err instanceof Error && "status" in err
      ? (err as Error & { status: number }).status
      : undefined;
    logger.error(
      { err: err instanceof Error ? err.message : String(err), statusCode },
      "Fetch failed — aborting run",
    );
    process.exitCode = 1;
    return { captured: 0, skipped: 0, failed: 0 };
  }

  if (threads.length === 0) {
    logger.info("No unread notifications");
    return { captured: 0, skipped: 0, failed: 0 };
  }

  logger.info({ count: threads.length }, "Processing notifications");

  let captured = 0;
  let skipped = 0;
  let failed = 0;

  for (const thread of threads) {
    const result = await processThread(thread, octokit, outputPath, logger);
    switch (result) {
      case "captured":
        captured++;
        break;
      case "skipped":
        skipped++;
        break;
      case "failed":
        failed++;
        break;
    }
  }

  logger.info({ captured, skipped, failed }, "Run complete");
  return { captured, skipped, failed };
}

async function processThread(
  thread: NotificationThread,
  octokit: Octokit,
  outputPath: string,
  logger: Logger,
): Promise<"captured" | "skipped" | "failed"> {
  let hydration;
  try {
    hydration = await hydrateSubject(thread, octokit);
  } catch (err) {
    logger.warn(
      { threadId: thread.id, err: err instanceof Error ? err.message : String(err) },
      "Hydration failed — skipping, thread left in inbox for retry",
    );
    return "skipped";
  }

  const record: FeedRecord = {
    id: thread.id,
    captured_at: new Date().toISOString(),
    reason: thread.reason,
    subject_type: thread.subject.type,
    title: thread.subject.title,
    repository: {
      full_name: thread.repository.full_name,
      html_url: thread.repository.html_url,
    },
    subject_url: thread.subject.url,
    latest_comment_url: thread.subject.latest_comment_url,
    subject_content: hydration.subject_body,
    latest_comment_content: hydration.comment_body,
    hydrated: hydration.hydrated,
  };

  try {
    await appendRecord(outputPath, record);
  } catch (err) {
    logger.warn(
      { threadId: thread.id, err: err instanceof Error ? err.message : String(err) },
      "File write failed — skipping, thread left in inbox for retry",
    );
    return "skipped";
  }

  try {
    await markThreadDone(octokit, thread.id);
  } catch (err) {
    logger.warn(
      { threadId: thread.id, err: err instanceof Error ? err.message : String(err) },
      "Mark-done failed — record in file but thread still in inbox (will re-capture next run)",
    );
    return "failed";
  }

  logger.debug({ threadId: thread.id, type: thread.subject.type }, "Captured");
  return "captured";
}
