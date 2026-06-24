import { readFileSync } from "node:fs";
import type { CliOptions } from "./types.js";

const DEFAULT_OUTPUT = "notifications.jsonl";

export function resolveToken(options: CliOptions): string {
  if (options.tokenFile) {
    try {
      const token = readFileSync(options.tokenFile, "utf-8").trim();
      if (!token) {
        throw new Error(`Token file "${options.tokenFile}" is empty.`);
      }
      return token;
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        throw new Error(`Token file "${options.tokenFile}" not found.`);
      }
      throw err;
    }
  }

  const envToken = process.env.GH_NOTIFICATIONS_TOKEN;
  if (envToken) {
    return envToken.trim();
  }

  throw new Error(
    "No GitHub token found. Set GH_NOTIFICATIONS_TOKEN env var or pass --token-file <path>.",
  );
}

export function resolveOutputPath(options: CliOptions): string {
  return options.output || DEFAULT_OUTPUT;
}
