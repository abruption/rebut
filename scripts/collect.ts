import { pathToFileURL } from "node:url";
import { collect } from "../src/client/collector.js";
export { collect, redact } from "../src/client/collector.js";
async function main() {
  const [root, id, requirements, ...files] = process.argv.slice(2);
  if (!root || !id || !requirements || !files.length)
    throw new Error(
      "Usage: npm run collect -- ROOT REQUEST_ID REQUIREMENTS FILE...",
    );
  // stdout only: caller chooses a protected destination. Never uploads automatically.
  process.stdout.write(
    JSON.stringify(await collect(root, files, requirements, id), null, 2) +
      "\n",
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    process.stderr.write(
      "Collection failed: check explicit paths, sizes, source type, and request fields.\n",
    );
    process.exitCode = 1;
  });
