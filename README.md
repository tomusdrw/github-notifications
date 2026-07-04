# GitHub Notifications Feed

A CLI for GitHub notifications and personal issue tracking. Three modes:

- **`capture`** (default) — Poll unread notifications, hydrate each one's content, append self-contained records to a local JSONL feed file, and mark threads done on GitHub. Stateful: it clears your inbox as it captures.
- **`assigned`** — List issues assigned to the authenticated user. Read-only.
- **`mentioned`** — List issues/PRs the authenticated user is @-mentioned in. Read-only.

The feed file is the durable source of truth; the GitHub inbox is drained as a side effect of capture.

---

## Quick start

```bash
npm install
export GH_NOTIFICATIONS_TOKEN="ghp_..."   # classic PAT, scopes below

# Capture unread notifications to ./notifications.jsonl
npx tsx src/index.ts

# List what's on your plate
npx tsx src/index.ts assigned
npx tsx src/index.ts mentioned --include-prs --json

# Or build and run
npm run build && node dist/index.js capture
```

---

## Command reference

### `gh-notifications` (no subcommand) / `gh-notifications capture`

Capture unread notifications to a JSONL feed file. Stateful.

```
gh-notifications [capture] [--token-file <path>] [--output <path>] [--verbose]
```

| Flag | Default | Description |
|---|---|---|
| `--token-file <path>` | _(env)_ | Read GitHub PAT from a file (avoids shell history) |
| `--output <path>` | `notifications.jsonl` | Feed file path. Created with mode `0600` if missing. |
| `--verbose` | off | Emit debug-level logs to stderr |

**Output streams:**
- **stderr** — structured JSON logs (pino). Progress + errors. Redacts the token.
- **stdout** — none.

**Exit codes:**
- `0` — run completed (possibly with per-notification skips/failures; see stderr `captured`/`skipped`/`failed` counts in the `"Run complete"` log line).
- `1` — fatal error (token missing/invalid, network down, feed fetch failed).

**State changes:**
- Appends one JSONL record per captured notification.
- Marks each captured thread done on GitHub (deletes it from the inbox).
- A hydration or write failure leaves the thread in the inbox for the next run.
- A mark-done failure leaves the record in the file **and** the thread in the inbox → the next run re-captures it (consumers must dedup on `id`).

### `gh-notifications assigned`

List issues assigned to the authenticated user. Read-only.

```
gh-notifications assigned [--state <state>] [--include-prs] [--limit <n>] [--json] [--token-file <path>] [--verbose]
```

### `gh-notifications mentioned`

List issues/PRs the authenticated user is mentioned in (per GitHub's `/issues?filter=mentioned` semantics — participant-level mentions, **not** arbitrary `@you` in comments). Read-only.

```
gh-notifications mentioned [--state <state>] [--include-prs] [--limit <n>] [--json] [--token-file <path>] [--verbose]
```

**Shared options for `assigned` / `mentioned`:**

| Flag | Default | Description |
|---|---|---|
| `--state <state>` | `open` | One of `open`, `closed`, `all`. |
| `--include-prs` | off | Include pull requests. Without this flag, only issues are returned. |
| `--limit <n>` | _(none)_ | Cap the number of results. `0` or negative = no cap. |
| `--json` | off | Emit a JSON array to stdout (schema below). |
| `--token-file <path>` | _(env)_ | Read GitHub PAT from a file. |
| `--verbose` | off | Emit debug-level logs to stderr. |

**Output streams:**
- **stdout** — the list (human-readable text by default, or JSON with `--json`).
- **stderr** — structured JSON logs (pino).

**Exit codes:**
- `0` — success (the list may be empty).
- `1` — fatal error (token, network, API).

**Human-readable format** (one entry per result, blank-line-free):

```
owner/repo #42 [open/Issue] Fix the parser
  https://github.com/owner/repo/issues/42
owner/repo #7 [closed/PR] Rewrite parser
  https://github.com/owner/repo/pull/7
```

An empty result prints `No items found.` (text mode) or `[]` (JSON mode).

---

## Authentication

The tool needs a **personal access token (classic)** with these scopes:

| Scope | Required for |
|---|---|
| `notifications` | `capture` (Notifications API) |
| `repo` | Private-repo issue/PR/commit hydration; private-repo results in `assigned`/`mentioned` |
| `security_events` | Dependabot alert hydration in `capture` |
| _(none extra)_ | `assigned`/`mentioned` against public repos |

For an autonomous agent, the minimum workable set is `notifications` + `repo` — `security_events` only affects a hydration path.

Provide the token via either:

- **Environment variable** `GH_NOTIFICATIONS_TOKEN` (default).
- **`--token-file <path>`** — read from a file; preferred for agents to avoid shell history and argv leakage.

If both are set, `--token-file` wins. If neither is set, the process exits `1` with a stderr error.

---

## Output schemas

### Feed record (`capture` → JSONL file)

One JSON object per line. The file is created with mode `0600` because it may contain private-repo content.

```json
{
  "id": "123456789",
  "captured_at": "2026-06-24T12:00:00.000Z",
  "reason": "mention",
  "subject_type": "Issue",
  "title": "Bug in the parser",
  "repository": {
    "full_name": "owner/repo",
    "html_url": "https://github.com/owner/repo"
  },
  "subject_url": "https://api.github.com/repos/owner/repo/issues/42",
  "latest_comment_url": "https://api.github.com/repos/owner/repo/issues/comments/99",
  "subject_content": "The issue body text...",
  "latest_comment_content": "The comment that triggered this notification...",
  "hydrated": true
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | GitHub notification thread ID. **Dedup key.** |
| `captured_at` | string (ISO 8601) | When this tool wrote the record. |
| `reason` | string | GitHub notification reason (`mention`, `assign`, `review_requested`, …). |
| `subject_type` | string | `Issue`, `PullRequest`, `Commit`, `Release`, `RepositoryVulnerabilityAlert`, `Discussion`, `CheckSuite`, `WorkflowRun`, … |
| `title` | string | Subject title from GitHub. |
| `repository.full_name` | string | `owner/repo`. |
| `repository.html_url` | string | `https://github.com/owner/repo`. |
| `subject_url` | string | REST API URL of the subject. |
| `latest_comment_url` | string | REST API URL of the triggering comment (may equal `subject_url`). |
| `subject_content` | string \| null | Hydrated body of the subject. `null` if envelope-only. |
| `latest_comment_content` | string \| null | Hydrated body of the triggering comment. `null` if envelope-only or same-as-subject. |
| `hydrated` | boolean | `false` for envelope-only records (see coverage table). |

### List item (`assigned`/`mentioned --json` → stdout)

A JSON array of objects:

```json
[
  {
    "number": 42,
    "title": "Fix the parser",
    "state": "open",
    "html_url": "https://github.com/owner/repo/issues/42",
    "repository_full_name": "owner/repo",
    "updated_at": "2026-07-04T12:00:00Z",
    "kind": "issue"
  }
]
```

| Field | Type | Notes |
|---|---|---|
| `number` | number | Issue/PR number within the repo. |
| `title` | string | |
| `state` | string | `open` or `closed`. |
| `html_url` | string | Browser URL. |
| `repository_full_name` | string | `owner/repo`. |
| `updated_at` | string (ISO 8601) | Last update on GitHub. |
| `kind` | string | `issue` or `pull_request`. Always present; filter client-side if needed. |

---

## Hydration coverage (`capture`)

| Subject type | Behavior |
|---|---|
| `Issue` | Full hydration (body + triggering comment) |
| `PullRequest` | Full hydration (body + triggering comment) |
| `Commit` | Full hydration (commit message) |
| `Release` | Full hydration (release notes) |
| `RepositoryVulnerabilityAlert` | Full hydration (Dependabot alert details) |
| `Discussion` | Envelope-only (GraphQL-only, out of REST scope) |
| `CheckSuite` / `WorkflowRun` | Envelope-only (undocumented by GitHub) |
| Unknown types | Envelope-only fallback |

Envelope-only records have `hydrated: false` and `null` content fields.

---

## Consumer contract (for pipelines reading the feed)

1. **Dedup on `id`.** A failed mark-done leaves the thread in the inbox; the next run re-captures it and appends a second record with the same `id`. Dedup prevents double-reaction.
2. **Skip a trailing partial line.** If the process is killed mid-write, the file may end with a line missing its `\n` terminator. Readers should ignore a final line without `\n`.
3. **Treat the file as append-only.** Existing records are never rewritten or deleted by this tool. Retention/pruning is the operator's responsibility.
4. **Order matters within a record** (`hydrate → write file → mark done`), but records from concurrent runs are **not** interleaved-safe — run only one capture at a time per feed file.

---

## Autonomous use playbook

This section is written for LLM agents driving the CLI.

### Deciding which subcommand to use

| Goal | Use |
|---|---|
| "What changed since last time?" / "Drain my inbox into the feed" | `capture` |
| "What's assigned to me right now?" | `assigned` (read-only, safe to call repeatedly) |
| "Where was I mentioned?" | `mentioned` (read-only) |
| Anything requiring comment bodies or thread content | `capture` then read the feed (`assigned`/`mentioned` return titles only) |

### Safety checklist before running `capture`

- [ ] Token is set (`GH_NOTIFICATIONS_TOKEN` or `--token-file`). Missing token → exit `1`.
- [ ] `--output` path is writable and not shared with another concurrent capture.
- [ ] You understand **`capture` mutates GitHub state**: captured threads are removed from the inbox. This is the intended behavior but is not reversible from this tool.

`assigned` and `mentioned` are read-only and safe to call any time.

### Detecting success

- **Exit code `0`** = the run completed. For `capture`, look at the stderr `"Run complete"` log line for `{captured, skipped, failed}` counts. Non-zero `skipped` or `failed` do **not** change the exit code — they are reported in logs only.
- **Exit code `1`** = fatal; see the stderr `"Fatal error"` log line. Common causes: missing/invalid token, network down, GitHub API rate limit exhausted.

### Parsing list output

Always pass `--json` when driving programmatically and parse stdout as a single JSON document (an array). Without `--json`, the text format is line-oriented but not machine-recommended.

### Retries

- `capture` is safe to retry — mark-done is idempotent and the feed is append-only with `id`-based dedup. A retry after a partial run will resume from whatever threads remain in the inbox.
- `assigned`/`mentioned` are read-only; retry freely.
- Rate-limit retries are handled internally (one retry on primary and secondary rate limits). Exhausting the budget surfaces as a fatal exit `1`.

### What this tool does **not** do

- No comment-level `@you` mention search (would require the Search API; `mentioned` uses GitHub's participant-based `/issues?filter=mentioned`).
- No way to capture **without** marking threads done. If you want a dry run, you must call the GitHub Notifications API directly.
- No structured run-summary on stdout from `capture` — counts are in stderr logs only. Parse pino JSON lines if you need them.
- No daemon, cron, or webhook mode. The operator schedules invocations.
- No conditional-request optimization (ETag/If-Modified-Since) in v1.

---

## Development

```bash
npm test           # vitest run
npm run test:watch # vitest watch
npm run typecheck  # tsc --noEmit
npm run build      # tsc → dist/
npm run dev        # tsx src/index.ts (alias for the default subcommand)
```

CI (`.github/workflows/ci.yml`) runs typecheck, test, and build on Node 22.

See **[AGENTS.md](./AGENTS.md)** for codebase navigation, conventions, and how to extend the tool.

---

## Limitations

- Manual invocation only — no daemon, cron, or webhook mode.
- No conditional-request optimization in v1 (the 5000/hr PAT budget is sufficient for manual runs).
- No built-in retention management — the operator owns pruning and archival of the feed file.
- Discussion and CI activity notifications are envelope-only (see hydration table above).
