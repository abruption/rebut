import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/pr-policy.yml", import.meta.url),
  "utf8",
);
const script = workflow
  .split("node --input-type=module <<'JS'\n")[1]!
  .split("          JS")[0]!
  .replace(/^          /gm, "");

async function check(body: string, issue: Record<string, unknown>, apiOk = true) {
  const process = {
    env: { GITHUB_REPOSITORY: "owner/repo", PR_NUMBER: "2", GH_TOKEN: "fixture" },
    exitCode: 0,
  };
  const requests: string[] = [];
  await runInNewContext(`(async () => { ${script} })()`, {
    process,
    console: { log() {}, error() {} },
    fetch: async (url: string) => {
      requests.push(url);
      return {
        ok: apiOk,
        json: async () =>
          url.endsWith("pulls/2")
            ? { body, created_at: "2026-11-13T02:00:00Z" }
            : issue,
      };
    },
  });
  return { exitCode: process.exitCode, requests };
}

const validIssue = { state: "open", created_at: "2026-11-13T01:00:00Z" };
describe("Issue-first PR policy", () => {
  it("uses a read-only base workflow without checking out or executing PR code", () => {
    expect(workflow).toMatch(/^  pull_request_target:$/m);
    expect(workflow).not.toMatch(/^  pull_request:$/m);
    expect(workflow).not.toMatch(/actions\/checkout|pull_request\.head|npm (?:ci|install)|: write/);
  });
  it("accepts an earlier open issue in this repository", async () => {
    const result = await check("## Issue\n\nCloses #1", validIssue);
    expect(result.exitCode).toBe(0);
    expect(result.requests).toEqual([
      "https://api.github.com/repos/owner/repo/pulls/2",
      "https://api.github.com/repos/owner/repo/issues/1",
    ]);
  });
  it.each(["No linked issue", "Closes #0", "Closes other/repo#1"])(
    "rejects absent or ineligible issue references: %s",
    async (body) => expect((await check(body, validIssue)).exitCode).toBe(1),
  );
  it.each([
    { ...validIssue, state: "closed" },
    { ...validIssue, created_at: "2026-11-13T03:00:00Z" },
    { ...validIssue, created_at: "invalid" },
    { ...validIssue, pull_request: { url: "fixture" } },
  ])("rejects an invalid linked issue: %j", async (issue) => {
    expect((await check("Closes #1", issue)).exitCode).toBe(1);
  });
  it("fails closed when GitHub cannot verify the metadata", async () => {
    expect((await check("Closes #1", validIssue, false)).exitCode).toBe(1);
  });
});
