import { fileURLToPath } from "node:url";

import { runCli } from "./features/migration-run/presentation/cli.js";

export const prototypeStatus = "environment-ready";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Notion2Loop failed: ${message}\n`);
    process.exitCode = 1;
  });
}
