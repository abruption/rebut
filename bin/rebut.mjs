#!/usr/bin/env node
import { runCli, safeError } from "../lib/cli.mjs";
runCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(safeError(error) + "\n");
  process.exitCode = 1;
});
