#!/usr/bin/env node

import { Command } from "commander";
import pino, { type Logger } from "pino";
import { resolveToken, resolveOutputPath } from "./config.js";
import { createOctokit } from "./github-client.js";
import { captureAll } from "./capture.js";
import {
  fetchUserIssues,
  filterIssues,
  applyLimit,
  formatItems,
  type IssueFilter,
  type IssueState,
} from "./list.js";
import type { CliOptions } from "./types.js";

const REDACT_PATHS = [
  "*.headers.authorization",
  "*.headers.Authorization",
  "*.token",
  "*.auth",
  "*.request.headers.authorization",
  "*.request.headers.Authorization",
];

function buildLogger(verbose: boolean): Logger {
  return pino(
    {
      level: verbose ? "debug" : "info",
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    },
    pino.destination(2),
  );
}

function toCommonOptions(rawOpts: Record<string, unknown>): CliOptions {
  return {
    tokenFile: rawOpts.tokenFile as string | undefined,
    output: rawOpts.output as string | undefined,
    verbose: (rawOpts.verbose as boolean) ?? false,
  };
}

async function makeOctokit(opts: CliOptions) {
  return createOctokit(resolveToken(opts));
}

async function runCapture(rawOpts: Record<string, unknown>): Promise<void> {
  const options = toCommonOptions(rawOpts);
  const logger = buildLogger(options.verbose);
  try {
    const outputPath = resolveOutputPath(options);
    logger.info({ output: outputPath }, "Starting GitHub notifications capture");
    const octokit = await makeOctokit(options);
    await captureAll(octokit, outputPath, logger);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "Fatal error",
    );
    process.exit(1);
  }
}

async function runList(
  rawOpts: Record<string, unknown>,
  filter: IssueFilter,
): Promise<void> {
  const options = toCommonOptions(rawOpts);
  const logger = buildLogger(options.verbose);
  try {
    const octokit = await makeOctokit(options);
    const state = (rawOpts.state as IssueState) ?? "open";
    const includePrs = (rawOpts.includePrs as boolean) ?? false;
    const asJson = (rawOpts.json as boolean) ?? false;
    const limit =
      rawOpts.limit !== undefined ? Number(rawOpts.limit) : undefined;

    const items = await fetchUserIssues(octokit, filter, state, logger);
    const filtered = applyLimit(filterIssues(items, includePrs), limit);
    process.stdout.write(formatItems(filtered, asJson) + "\n");
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "Fatal error",
    );
    process.exit(1);
  }
}

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option("--token-file <path>", "Read GitHub PAT from this file")
    .option("--verbose", "Enable debug logging");
}

function addListOptions(cmd: Command): Command {
  return addCommonOptions(cmd)
    .option("--state <state>", "Issue state: open (default), closed, or all", "open")
    .option("--include-prs", "Include pull requests in addition to issues")
    .option("--limit <n>", "Cap number of results")
    .option("--json", "Output as JSON");
}

const program = new Command();

program
  .name("gh-notifications")
  .description(
    "Poll GitHub notifications, hydrate content, append to a local JSONL feed file.",
  );

// Default action (no subcommand): capture. Preserves backward compatibility.
addCommonOptions(program).option(
  "--output <path>",
  "Feed file path (default: notifications.jsonl)",
);
program.action((rawOpts) => {
  void runCapture(rawOpts);
});

const captureCmd = program
  .command("capture")
  .description("Capture unread notifications to a local JSONL feed file");
addCommonOptions(captureCmd).option(
  "--output <path>",
  "Feed file path (default: notifications.jsonl)",
);
captureCmd.action((rawOpts) => {
  void runCapture(rawOpts);
});

const assignedCmd = program
  .command("assigned")
  .description("List issues assigned to the authenticated user");
addListOptions(assignedCmd).action((rawOpts) => {
  void runList(rawOpts, "assigned");
});

const mentionedCmd = program
  .command("mentioned")
  .description("List issues/PRs the authenticated user is mentioned in");
addListOptions(mentionedCmd).action((rawOpts) => {
  void runList(rawOpts, "mentioned");
});

program.parse();
