import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/publish.yml", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const verifier = workflow.match(
  /- name: Verify the public registry artifact\n[\s\S]*?node --input-type=module <<'JS'\n([\s\S]*?)^ +JS$/m,
)?.[1];

it("runs registry verification after publication outside the npm deployment job", () => {
  const jobs = workflow.split("\njobs:\n")[1]?.split(/^  (?=[\w-]+:\n)/m);
  const publish = jobs?.find((job) => job.startsWith("publish:\n"));
  const verify = jobs?.find((job) => job.startsWith("verify-registry:\n"));
  expect(publish).toBeDefined();
  expect(verify).toBeDefined();
  expect(publish).toMatch(/^    environment: npm$/m);
  expect(publish).toMatch(/^      id-token: write$/m);
  expect(publish).toMatch(/^ +npm publish /m);
  expect(publish).not.toContain("Verify the public registry artifact");
  expect(verify).toMatch(/^    needs: \[build, publish\]$/m);
  expect(verify).toMatch(/^    permissions: \{\}$/m);
  expect(verify).not.toMatch(
    /^ +(?:environment|id-token|if|continue-on-error):/m,
  );
  expect(verify).toContain("VERSION: ${{ needs.build.outputs.version }}");
  expect(verify).toContain("SHA256: ${{ needs.build.outputs.sha256 }}");
  expect(verify).not.toMatch(/^ +npm publish /m);
  expect(verify).toContain("Verify the public registry artifact");
});

const artifact = "synthetic release tarball bytes";
const sha256 = createHash("sha256").update(artifact).digest("hex");
const tarball = "https://registry.npmjs.org/rebut-mcp/-/rebut-mcp-0.3.3.tgz";
const metadata = {
  name: "rebut-mcp",
  version: "0.3.3",
  dist: {
    tarball,
    attestations: {
      provenance: { predicateType: "https://slsa.dev/provenance/v1" },
    },
  },
};

function runVerifier(responses, { repeatLast = false, expire = false } = {}) {
  expect(verifier).toBeDefined();
  const fixture = `
    import assert from 'node:assert/strict';
    const responses = ${JSON.stringify(responses)};
    const deadlineController = new AbortController();
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = ms => ms === 420_000 ? deadlineController.signal : timeout(ms);
    const setTimeout = (fn, ms) => {
      assert.equal(ms, 15_000);
      if (${expire}) queueMicrotask(() => deadlineController.abort());
      else queueMicrotask(fn);
    };
    let index = 0;
    globalThis.fetch = async (url, options) => {
      assert.equal(options.redirect, 'manual');
      assert.ok(options.signal instanceof AbortSignal);
      assert.ok(!options.signal.aborted);
      const next = responses[index++] ?? (${repeatLast} ? responses.at(-1) : undefined);
      assert.ok(next, 'Unexpected registry request');
      const target = new URL(url);
      assert.equal(target.origin, 'https://registry.npmjs.org');
      assert.equal(target.pathname, next.path);
      if (next.timeout) throw new DOMException('Timed out', 'TimeoutError');
      if (next.interruptedBody) {
        return new Response(new ReadableStream({
          start(controller) { controller.error(new TypeError('terminated')); },
        }));
      }
      return new Response(next.body ?? null, { status: next.status ?? 200 });
    };
  `;
  return spawnSync(process.execPath, ["--input-type=module"], {
    env: { VERSION: "0.3.3", SHA256: sha256 },
    input: fixture + verifier,
    encoding: "utf8",
    timeout: 5_000,
  });
}

const registryMetadata = (body = metadata) => ({
  path: "/rebut-mcp/0.3.3",
  body: JSON.stringify(body),
});
const download = (body = artifact) => ({
  path: new URL(tarball).pathname,
  body,
});

it("verifies once metadata, provenance and the tarball become visible", () => {
  const result = runVerifier([
    { path: registryMetadata().path, status: 404 },
    registryMetadata({ ...metadata, dist: { tarball } }),
    registryMetadata(),
    { path: download().path, status: 404 },
    registryMetadata(),
    download(),
  ]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("Registry metadata HTTP 404");
  expect(result.stdout).toContain("Registry provenance unavailable");
  expect(result.stdout).toContain("Tarball HTTP 404");
  expect(result.stdout).toContain(`Verified rebut-mcp@0.3.3 (${sha256})`);
});

it("retries transient HTTP errors, timeouts and interrupted downloads", () => {
  const result = runVerifier([
    { path: registryMetadata().path, status: 429 },
    { path: registryMetadata().path, timeout: true },
    registryMetadata(),
    { path: download().path, status: 503 },
    registryMetadata(),
    { path: download().path, interruptedBody: true },
    registryMetadata(),
    download(),
  ]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("Registry metadata HTTP 429");
  expect(result.stdout).toContain(
    "Registry metadata request or download interrupted",
  );
  expect(result.stdout).toContain("Tarball HTTP 503");
  expect(result.stdout).toContain("Tarball request or download interrupted");
});

it.each([
  [
    [registryMetadata(), { path: download().path, status: 403 }],
    "Tarball verification failed: HTTP 403",
  ],
  [
    [registryMetadata(), { path: download().path, status: 302 }],
    "Tarball verification failed: HTTP 302",
  ],
  [
    [registryMetadata(), download("wrong bytes")],
    "Published artifact hash mismatch",
  ],
  [
    [
      registryMetadata({
        ...metadata,
        dist: { ...metadata.dist, tarball: undefined },
      }),
    ],
    "Unexpected tarball URL",
  ],
  [[{ path: registryMetadata().path, body: "invalid JSON" }], "SyntaxError:"],
  [
    [registryMetadata({ ...metadata, version: "0.3.2" })],
    "Published package identity mismatch",
  ],
  [
    [
      registryMetadata({
        ...metadata,
        dist: { ...metadata.dist, tarball: "https://example.invalid/file.tgz" },
      }),
    ],
    "Unexpected tarball URL",
  ],
])(
  "fails immediately on non-transient registry or integrity errors",
  (responses, message) => {
    const result = runVerifier(responses);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(result.stdout).not.toContain("Registry verification attempt");
  },
);

it("stops after the bounded attempts and reports the last failure", () => {
  const result = runVerifier([{ path: registryMetadata().path, status: 404 }], {
    repeatLast: true,
  });
  expect(result.status).toBe(1);
  expect(result.stdout.match(/Registry verification attempt/g)).toHaveLength(
    25,
  );
  expect(result.stderr).toContain(
    "verification did not finish: Registry metadata HTTP 404",
  );
});

it("stops before another request when the overall verification deadline expires", () => {
  const result = runVerifier(
    [registryMetadata(), { path: download().path, status: 404 }],
    { expire: true },
  );
  expect(result.status).toBe(1);
  expect(result.stdout.match(/Registry verification attempt/g)).toHaveLength(1);
  expect(result.stderr).toContain(
    "verification did not finish: Tarball HTTP 404 (deadline reached)",
  );
});
