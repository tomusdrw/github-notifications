# GitHub Notifications Feed

Polls your GitHub notifications, hydrates each one's content, and appends self-contained records to a local JSONL feed file. Marks threads done on GitHub once captured. Designed as a capture-only feed that an LLM pipeline reads and reacts to.

## Quick start

```bash
# Install dependencies
npm install

# Set up your GitHub token
export GH_NOTIFICATIONS_TOKEN="ghp_your_token_here"

# Run capture
npx tsx src/index.ts

# Or build and run
npm run build
node dist/index.js
```

## Configuration

### Token

The tool needs a **personal access token (classic)** with these scopes:

- `notifications` — required, for the Notifications API
- `repo` — for private-repo issue/PR/commit hydration
- `security_events` — for Dependabot alert hydration on private repos

Provide the token via:

- **Environment variable:** `GH_NOTIFICATIONS_TOKEN`
- **Token file:** `--token-file <path>` (reads the token from a file; avoids exposing it in argv or shell history)

```bash
# Environment variable (default)
export GH_NOTIFICATIONS_TOKEN="ghp_..."

# Token file (alternative)
echo "ghp_..." > ~/.config/gh-token
npx tsx src/index.ts --token-file ~/.config/gh-token
```

### CLI flags

| Flag | Description |
|------|-------------|
| `--token-file <path>` | Read GitHub PAT from this file |
| `--output <path>` | Feed file path (default: `notifications.jsonl`) |
| `--verbose` | Enable debug logging |

## Output format

The feed file is **JSONL** (one JSON object per line). Each record is self-contained:

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

The file is created with mode `0600` (owner read/write only) because it contains private-repo content.

## Hydration coverage

| Subject type | v1 behavior |
|---|---|
| Issue | Full hydration (body + triggering comment) |
| PullRequest | Full hydration (body + triggering comment) |
| Commit | Full hydration (commit message) |
| Release | Full hydration (release notes) |
| RepositoryVulnerabilityAlert | Full hydration (Dependabot alert details) |
| Discussion | Envelope-only (GraphQL-only, out of REST scope) |
| CheckSuite / WorkflowRun | Envelope-only (undocumented by GitHub) |
| Unknown types | Envelope-only fallback |

Envelope-only records have `hydrated: false` and `null` content fields.

## Consumer contract

Downstream pipelines reading the feed file **MUST dedup on the `id` field**. If a mark-done API call fails after the record is written to the file, the thread stays in the GitHub inbox and will be re-captured on the next run, producing a duplicate record. Dedup on `id` prevents double-reaction.

### Partial-line recovery

If the process is killed mid-write, the file may have a partial trailing line (no newline terminator). Downstream readers should skip a trailing line that doesn't end with `\n`.

## Behavior

- **Ordering invariant:** hydrate → write file → mark done, per notification. A failed hydration or write leaves the thread in the inbox for retry on the next run.
- **Failure isolation:** a failure on one notification does not abort capture of the remaining notifications.
- **Append-only:** existing records are never rewritten or deleted.
- **Mark-done ownership:** the tool clears your GitHub inbox as it captures. The feed file is the durable source of truth.

## Development

```bash
npm test          # Run tests
npm run test:watch # Watch mode
npm run typecheck  # Type-check without emitting
npm run build      # Compile to dist/
```

## Limitations

- Manual invocation only — no daemon, cron, or webhook mode.
- No conditional-request optimization in v1 (the 5000/hr PAT budget is sufficient for manual runs).
- No built-in retention management — the operator owns pruning and archival of the feed file.
- Discussion and CI activity notifications are envelope-only (see hydration table above).
