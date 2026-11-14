import assert from "node:assert/strict";
import { readFileSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function releaseVersion(tag) {
  assert.match(
    tag ?? "",
    /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/,
  );
  return tag.slice(1);
}
export function validateNpmVersion(version) {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const [major, minor, patch] = version.split(".").map(Number);
  assert(
    major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1))),
  );
}
export function validateAdvance(version, latest) {
  releaseVersion(`v${version}`);
  releaseVersion(`v${latest}`);
  const a = version.split(".").map(BigInt),
    b = latest.split(".").map(BigInt);
  const difference = a.findIndex((n, i) => n !== b[i]);
  assert(
    difference >= 0 && a[difference] > b[difference],
    "Version must advance the current stable latest",
  );
}
export function validateIdentity(tag, manifest, sha, tagSha, lock) {
  const version = releaseVersion(tag);
  assert.equal(manifest.name, "rebut-mcp");
  assert.equal(manifest.version, version);
  assert.notEqual(manifest.private, true);
  assert.equal(manifest.publishConfig?.access, "public");
  assert.equal(
    manifest.repository?.url,
    "git+https://github.com/abruption/rebut.git",
  );
  assert.equal(lock.version, version);
  assert.equal(lock.packages?.[""]?.version, version);
  assert.match(sha ?? "", /^[a-f0-9]{40}$/);
  assert.equal(
    tagSha,
    sha,
    "Tag must name this workflow's exact main source commit",
  );
  return version;
}
export function validatePack(tag, pack) {
  const version = releaseVersion(tag);
  assert.equal(pack.length, 1);
  const item = pack[0];
  assert.equal(item.name, "rebut-mcp");
  assert.equal(item.version, version);
  assert.equal(item.filename, `rebut-mcp-${version}.tgz`);
  const paths = item.files.map((x) => x.path);
  for (const required of [
    "bin/rebut.mjs",
    "lib/cli.mjs",
    "migrations/0001_ledger.sql",
    "migrations/0002_profiles.sql",
  ])
    assert(paths.includes(required));
  for (const path of paths) {
    assert(
      /^(?:README(?:\.[a-zA-Z-]+)?\.md|LICENSE|package\.json|config\.example\.json|bin\/rebut\.mjs|lib\/cli\.mjs|src\/contracts\.ts|docs\/(?:guide\/(?:[a-zA-Z-]+\/)?[a-zA-Z0-9_-]+\.md|releases\/[a-zA-Z0-9._-]+\.md)|migrations\/\d+_[a-z_]+\.sql)$/.test(
        path,
      ),
      "Unexpected package file",
    );
    assert(
      !/(?:^|\/)\./.test(path) &&
        !path.includes("..") &&
        !path.includes(".private.") &&
        !path.includes("\\"),
    );
  }
  return item;
}
async function main() {
  const tag = process.env.RELEASE_TAG;
  if (process.argv[2] === "identity") {
    const git = (args) =>
      execFileSync("git", args, { encoding: "utf8" }).trim();
    validateNpmVersion(
      execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
    );
    releaseVersion(tag); // Validate before passing the tag to git.
    const version = validateIdentity(
      tag,
      JSON.parse(readFileSync("package.json")),
      process.env.GITHUB_SHA,
      git(["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]),
      JSON.parse(readFileSync("package-lock.json")),
    );
    assert.equal(
      process.env.GITHUB_SHA,
      git(["rev-parse", "--verify", "origin/main^{commit}"]),
      "Main advanced before validation",
    );
    const response = await fetch(
      `https://registry.npmjs.org/rebut-mcp/${version}`,
      { signal: AbortSignal.timeout(15000) },
    );
    assert.equal(
      response.status,
      404,
      "Version exists or registry preflight failed; do not publish",
    );
    const latestResponse = await fetch(
      "https://registry.npmjs.org/rebut-mcp/latest",
      { signal: AbortSignal.timeout(15000) },
    );
    assert.equal(latestResponse.status, 200, "Cannot inspect current latest");
    validateAdvance(version, (await latestResponse.json()).version);
  } else if (process.argv[2] === "artifact") {
    const item = validatePack(
      tag,
      JSON.parse(readFileSync("release-artifact/pack.json")),
    );
    const sha256 = createHash("sha256")
      .update(readFileSync(`release-artifact/${item.filename}`))
      .digest("hex");
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${item.version}\nsha256=${sha256}\n`,
    );
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## npm release candidate\n\n- Source: \`${process.env.GITHUB_SHA}\`\n- Package: \`rebut-mcp@${item.version}\`\n- SHA-256: \`${sha256}\`\n\nAwaiting the npm Environment owner's explicit approval.\n`,
    );
  } else throw new Error("Expected identity or artifact");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
