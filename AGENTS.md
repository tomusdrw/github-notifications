# AGENTS.md

Guide for AI agents (and humans) working on this codebase. Read this before editing.

## What this project is

A Node.js CLI (`gh-notifications`) with three subcommands:

- `capture` (default) — poll unread GitHub notifications, hydrate content, append to a JSONL feed, mark threads done.
- `assigned` — list issues assigned to the authenticated user.
- `mentioned` — list issues/PRs the user is mentioned in.

TypeScript + ESM (`"type": "module"` in `package.json`). Target: Node 22. Octokit for GitHub access. Vitest for tests. Pino for logs. Commander for CLI parsing.

See [README.md](./README.md) for user-facing behavior; this file is about the code.

## Commands you must run before considering work done

```bash
npm run typecheck   # tsc --noEmit — must pass with zero errors
npm test            # vitest run — must pass
npm run build       # tsc → dist/ — must succeed
```

CI (`.github/workflows/ci.yml`) runs the same three. If CI is red on your PR, it's one of these.

There is no separate lint step. Typecheck is the gate.

## Architecture

### Module map

```
src/index.ts          CLI entry. Commander setup, subcommand wiring, logger construction.
src/config.ts         Resolves token + output path from flags/env. Throws on missing token.
src/github-client.ts  createOctokit(), fetchNotifications(), markThreadDone().
src/capture.ts        captureAll() — the per-thread pipeline (hydrate → write → mark done).
src/hydrate.ts        hydrateSubject() — fetches body + triggering comment per subject type.
src/feed-file.ts      appendRecord() — append-only JSONL writer with 0600 mode on create.
src/list.ts           fetchUserIssues() + filter/format helpers for assigned/mentioned.
src/types.ts          Shared interfaces (NotificationThread, FeedRecord, IssueListItem, CliOptions, …).
```

### Data flow

`capture`:
```
fetchNotifications (paginate GET /notifications, filter unread)
  → for each thread:
      hydrateSubject (GET subject URL; GET latest_comment_url if different)
      → appendRecord (append JSONL line, create file 0600 if missing)
      → markThreadDone (DELETE /notifications/threads/{id})
```

Ordering invariant per thread: **hydrate → write → mark done**. A failure at step 1 or 2 leaves the thread in the inbox for the next run. A failure at step 3 leaves both the record and the thread (consumer dedups on `id`).

`assigned` / `mentioned`:
```
fetchUserIssues (paginate GET /issues with filter={assigned|mentioned}, state)
  → filterIssues (drop PRs unless --include-prs)
  → applyLimit
  → formatItems (text or JSON) → stdout
```

### Exit-code semantics

- Fatal errors (token missing, fetch/network failure at top level, uncaught throw in a subcommand handler) → `process.exit(1)` in `src/index.ts`.
- `captureAll` sets `process.exitCode = 1` if the initial notifications fetch fails.
- Per-thread skip/fail in capture does **not** change the exit code; counts surface only in stderr logs (`"Run complete"` line: `{captured, skipped, failed}`).
- List subcommands exit `0` on success even when the result is empty.

### Streams

- Pino logs → stderr (`pino.destination(2)` in `src/index.ts`).
- List output → stdout (`process.stdout.write` in `src/index.ts`).
- Capture produces no stdout.

Token redaction is configured in `buildLogger` (`REDACT_PATHS` in `src/index.ts`). If you add a code path that logs token-shaped data, extend that list.

## Conventions

- **No code comments.** The codebase has none; keep it that way unless asked.
- **ESM imports use `.js` extensions** even for TS sources (Node ESM resolution). Example: `import { captureAll } from "./capture.js";`.
- **Append-only feed.** Never rewrite or delete records. New subjects get new lines.
- **No comments, no `any`.** `tsc --noEmit` is strict.
- **Tests live in `tests/` mirroring `src/` names** (`github-client.ts` → `github-client.test.ts`). Mock Octokit with a plain object cast to `Octokit` — see `tests/list.test.ts` for the pattern.
- **Token never in logs.** Use the redact paths; never log raw auth.
- **CLI flags per subcommand.** Don't add global flags beyond `--token-file` and `--verbose` unless they apply to every subcommand. The default action and `capture` accept `--output`; list subcommands do not.

## Adding a new subcommand

1. Add the data fetch + formatting in a new module under `src/` (e.g. `src/<name>.ts`). Pure functions for fetch, filter, format — testable without Commander.
2. Add a `run<Name>(rawOpts, ...)` handler in `src/index.ts` following the `runCapture` / `runList` shape: build options, build logger, make octokit, try/catch with `process.exit(1)` on fatal.
3. Register with `program.command("<name>")` and chain `addCommonOptions(cmd)` (or `addListOptions(cmd)` if it's list-shaped).
4. Add the option set to the README command reference and the subcommands table.
5. Add a test file in `tests/` covering the fetch mapper, filters, and formatters as pure functions — not the Commander wiring.
6. Run `npm run typecheck && npm test && npm run build`.

## Extending hydration

For a new notification `subject_type`:

1. Decide full-hydrate vs envelope-only. Full-hydrate only if the subject's REST URL returns a body/message/summary-shaped object.
2. If full-hydrate, add the type to `HYDRATED_TYPES` in `src/hydrate.ts`. The existing `extractContent` covers `body`, `message`, `summary`, and `commit.message`; extend it only if the new type has a different field.
3. Otherwise it falls through to envelope-only automatically (`hydrated: false`, null content).
4. Update the hydration table in the README.
5. Add a test case in `tests/hydrate.test.ts`.

## Known gotchas

- **The `/issues` endpoint returns issues AND pull requests.** `src/list.ts` distinguishes them via the `pull_request` field on the raw item. `--include-prs` is opt-in; default is issues only.
- **`mentioned` is participant-based, not comment-search.** GitHub's `/issues?filter=mentioned` returns threads where the user is in the participant list, not every thread with an `@you` in a comment. Comment-level search would need `/search/issues` (different rate-limit/pagination) and is not implemented.
- **`octokit` is mocked loosely in tests.** Casting a `{ paginate: vi.fn() }` object to `Octokit` is the established pattern; tsc accepts it via `unknown`. Don't tighten this without refactoring every test.
- **`capture` is the default action** for backward compatibility — running `gh-notifications` with no subcommand triggers capture. Don't remove this without coordination.
- **No conditional requests** (ETag/If-Modified-Since). Manual runs fit within the 5000/hr budget. Adding this would change `fetchNotifications` and the hydrate fetches.

## Files you likely don't need to touch

- `src/feed-file.ts` — stable; the 0600-on-create behavior is load-bearing.
- `src/types.ts` — add fields, don't remove or rename existing ones (feed readers depend on them).
- `package.json` `bin` entry — points at `dist/index.js`; only change if you move the entry.

## When in doubt

Read `src/index.ts` first — it's the wiring diagram. Then follow the handler for the subcommand you care about. Tests under `tests/` are the source of truth for expected behavior of each module's pure functions.
