---
date: 2026-06-24
topic: github-notifications-feed
---

# GitHub Notifications Feed

## Summary

A CLI run on demand that polls your GitHub notifications, fetches the content behind each one, appends each as a self-contained record to a local file, and marks the thread done on GitHub once it's safely captured. The file is the durable feed an LLM pipeline reads and reacts to.

## Problem Frame

GitHub's notification inbox surfaces events that matter — mentions, assigns, review requests, CI on your runs, activity in repos you watch. An LLM that could *react* to these (draft a reply, triage an issue, summarize a thread) has no programmatic handle on the inbox today: you triage by hand at github.com/notifications, and the LLM never sees the events.

The blocker isn't the events themselves — GitHub exposes them via the Notifications API, with a `reason` field that matches the trigger list (mention, assign, review_requested, team_mention, ci_activity, and the rest). The blocker is that the notification envelope carries only a title and a subject URL, not the actual content the LLM would react to. A capture step has to hydrate each notification by fetching its subject before the data is useful to a downstream agent.

This tool is that capture step. It runs when invoked, drains new notifications into a self-contained file with their content attached, and clears them from the GitHub inbox so the inbox and the file don't drift apart. The LLM pipeline's job — reading the file and reacting — is separate and out of scope here.

## Key Decisions

**The tool owns the GitHub inbox.** After capturing a notification, the tool marks the thread done on GitHub (`DELETE /notifications/threads/{id}`), removing it from the default inbox view. This makes the local file the source of truth for triage. The alternative — tracking read state locally without mutating GitHub — was rejected because the user wants the inbox cleared as part of the workflow, not a second surface to reconcile.

**Full content is hydrated at capture time.** Each new notification triggers an extra fetch of its subject URL (and latest comment URL when distinct) to pull the actual body or comment text. The file is self-contained: a downstream LLM reacts to what's in the file without a second round of GitHub API calls. The cost is N extra calls per poll for N new notifications, paid only for new items.

**The tool is one-way.** It captures and clears. It does not post comments, close issues, assign reviewers, or otherwise act on GitHub beyond mark-done. Reactions live entirely in the downstream LLM pipeline that reads the file.

**Run model is manual / on-demand.** No daemon, no cron. The operator (human or agent pipeline) invokes the tool when they want to check; it polls once, captures, exits. This fits the consumption model — the LLM runs it, reads the file, reacts — without the carrying cost of a background process.

## Requirements

### Capture lifecycle

- R1. On each invocation, the tool fetches unread notifications from `GET /notifications` (no `participating` filter), covering both personal interactions and watched-repo activity.
- R2. For each new notification, the tool fetches the subject content (the body for issues/PRs, the comment text for comment-triggered notifications) so the captured record is self-contained.
- R3. Each captured notification is appended to the local feed file with its envelope (reason, title, repo, subject URL, timestamp) and its hydrated content.
- R4. A notification is marked done on GitHub (`DELETE /notifications/threads/{id}`) only after both the file write and content hydration have succeeded.
- R5. On the next invocation, the tool does not re-capture notifications it has already marked done.

### Failure handling

- R6. If content hydration for a notification fails, the tool does not mark that thread done; it remains in the GitHub inbox and is retried on the next invocation.
- R7. If the file write fails for a notification, the tool does not mark that thread done; same retry behavior as R6.
- R8. A failure on one notification does not abort capture of the remaining notifications in the same invocation.

### File output

- R9. The feed file is append-only — new captures are added, existing records are never rewritten or deleted by the tool.
- R10. Each record is independently parseable (no cross-record state required to read one entry).

### Authentication and configuration

- R11. The tool authenticates to the GitHub API via a personal access token (classic) with the `notifications` scope (and `repo` scope if subject hydration needs private-repo access).
- R12. The token is read from an explicit source (environment variable or config file), never committed to the repo.

## Actors

- A1. **Operator** — the human or agent pipeline that invokes the tool and consumes the feed file.
- A2. **GitHub Notifications API** — the source of notification threads and the target of mark-done mutations.
- A3. **Feed file** — the durable local artifact; the interface between capture and any downstream LLM reaction.

## Key Flows

- F1. Normal capture
  - **Trigger:** Operator invokes the tool.
  - **Actors:** A1, A2, A3.
  - **Steps:** Tool fetches unread notifications from GitHub; for each, hydrates subject content, appends a record to the feed file, then marks the thread done on GitHub.
  - **Outcome:** All newly-arrived notifications are in the file and cleared from the inbox.

- F2. Hydration failure
  - **Trigger:** A subject fetch returns an error or times out.
  - **Actors:** A2, A3.
  - **Steps:** Tool skips the file write and mark-done for that thread; logs/surfaces the failure; continues with the remaining notifications.
  - **Outcome:** The failed notification stays in the GitHub inbox and is retried next invocation. Other notifications in the same run are unaffected.

- F3. File write failure
  - **Trigger:** The append to the feed file fails (disk, permissions).
  - **Actors:** A3.
  - **Steps:** Tool does not mark the thread done; surfaces the failure; decides per remaining notifications whether to continue.
  - **Outcome:** The notification stays in the inbox; nothing is lost because mark-done didn't fire.

## Acceptance Examples

- AE1. **Covers R4, R6, R7.** Given a run where the tool successfully fetches a notification and hydrates its content, when the file append succeeds, then the tool marks the thread done on GitHub. Given the same run but the file append fails, then the tool does not mark done and the thread remains in the inbox.

- AE2. **Covers R8.** Given a run with three new notifications where the middle one's hydration fails, when the run completes, then notifications one and three are captured to the file and marked done, and notification two remains in the inbox for retry.

- AE3. **Covers R5.** Given a notification that was captured and marked done in a previous run, when the tool runs again, then it does not produce a duplicate record in the file for that notification.

- AE4. **Covers R2.** Given a notification triggered by a comment on a PR, when the tool captures it, then the record contains the comment text (not just the PR title and URL).

## Scope Boundaries

**Outside this tool's identity:**

- Actions back to GitHub beyond mark-done (commenting, closing, assigning, merging). The LLM reaction pipeline is separate.
- Capture of all repo activity independent of subscription state (the Events API / webhooks firehose). The tool is scoped to what the Notifications API returns.
- Real-time push delivery (webhooks to a local server). Capture is poll-on-invoke only.
- Background scheduling (cron, launchd, long-running daemon). Invocation is manual.

## Dependencies / Assumptions

- The GitHub Notifications API requires a personal access token (classic) with the `notifications` scope; fine-grained tokens are not supported per the API docs.
- The `X-Poll-Interval` and `If-Modified-Since` headers exist to support polling efficiently; the tool should respect `X-Poll-Interval` at minimum so it doesn't get rate-limited.
- Subject hydration may require additional API calls per notification type (issues, PRs, commits each have their own endpoint shapes).
- The feed file is the durable source of truth. GitHub's inbox, once a thread is marked done, surfaces it only under the inbox *Done* filter — so a lost feed file means re-triaging via that filter, not a clean re-capture.

## Outstanding Questions

**Deferred to planning:**

- Exact record format for the feed file (JSONL, one-JSON-per-block, or markdown). Affects how the downstream LLM pipeline parses it, but doesn't change capture behavior.
- Whether to hydrate *all* notification types or only the common ones (issue, PR, commit, release) in v1, with a fallback envelope-only record for unusual types.
- How to handle the `X-Poll-Interval` header in a manual-run model — whether the tool should warn or refuse if invoked too frequently, or just rely on the operator.
- Whether to surface run summaries (captured N, skipped M, failed K) to stdout, a log file, or both.
