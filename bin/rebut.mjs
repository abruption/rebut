#!/usr/bin/env node
import { runCli, safeError } from "../lib/cli.mjs";
runCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(safeError(error) + "\n");
  if (!process.exitCode) process.exitCode = 1;
});
