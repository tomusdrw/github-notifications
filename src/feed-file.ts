import { appendFile, stat } from "node:fs/promises";
import type { FeedRecord } from "./types.js";

export async function appendRecord(outputPath: string, record: FeedRecord): Promise<void> {
  const line = JSON.stringify(record) + "\n";

  try {
    await stat(outputPath);
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      await appendFile(outputPath, line, { mode: 0o600 });
      return;
    }
    throw err;
  }

  await appendFile(outputPath, line);
}
