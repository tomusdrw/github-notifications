#!/usr/bin/env node

import { Command } from "commander";
import pino from "pino";
import { resolveToken, resolveOutputPath } from "./config.js";
import { createOctokit } from "./github-client.js";
import { captureAll } from "./capture.js";
import type { CliOptions } from "./types.js";

const program = new Command();

program
  .name("gh-notifications")
  .description("Poll GitHub notifications, hydrate content, append to a local JSONL feed file.")
  .option("--token-file <path>", "Read GitHub PAT from this file")
  .option("--output <path>", "Feed file path (default: notifications.jsonl)")
  .option("--verbose", "Enable debug logging");

program.parse();
const rawOpts = program.opts();

const options: CliOptions = {
  tokenFile: rawOpts.tokenFile,
  output: rawOpts.output,
  verbose: rawOpts.verbose ?? false,
};

export const logger = pino(
  {
    level: options.verbose ? "debug" : "info",
    redact: {
      paths: [
        "*.headers.authorization",
        "*.headers.Authorization",
        "*.token",
        "*.auth",
        "*.request.headers.authorization",
        "*.request.headers.Authorization",
      ],
      censor: "[REDACTED]",
    },
  },
  pino.destination(2),
);

async function main(): Promise<void> {
  try {
    const token = resolveToken(options);
    const outputPath = resolveOutputPath(options);

    logger.info({ output: outputPath }, "Starting GitHub notifications capture");

    const octokit = createOctokit(token);
    await captureAll(octokit, outputPath, logger);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "Fatal error");
    process.exit(1);
  }
}

main();
