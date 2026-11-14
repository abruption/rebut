import { expect, it } from "vitest";
import {
  releaseVersion,
  validateNpmVersion,
  validateAdvance,
  validateIdentity,
  validatePack,
} from "../scripts/release-policy.mjs";
const sha = "a".repeat(40);
const manifest = {
  name: "rebut-mcp",
  version: "0.2.1",
  publishConfig: { access: "public" },
  repository: { url: "git+https://github.com/abruption/rebut.git" },
};
const lock = { version: "0.2.1", packages: { "": { version: "0.2.1" } } };
it("rejects unsafe tags and release identity/provenance mismatches", () => {
  expect(releaseVersion("v0.2.1")).toBe("0.2.1");
  for (const tag of [
    "v01.2.1",
    "v0.2.1-beta",
    "--help",
    "v0.2.1\n",
    "v0.2.1;echo bad",
  ])
    expect(() => releaseVersion(tag)).toThrow();
  expect(validateIdentity("v0.2.1", manifest, sha, sha, lock)).toBe("0.2.1");
  expect(() =>
    validateIdentity("v0.2.1", manifest, sha, "b".repeat(40), lock),
  ).toThrow();
  expect(() =>
    validateIdentity("v0.2.1", { ...manifest, name: "other" }, sha, sha, lock),
  ).toThrow();
  expect(() =>
    validateIdentity("v0.2.1", manifest, sha, sha, {
      ...lock,
      version: "0.2.0",
    }),
  ).toThrow();
});
it("rejects package omissions and private or unexpected artifacts", () => {
  const files = [
    "bin/rebut.mjs",
    "lib/cli.mjs",
    "migrations/0001_ledger.sql",
    "migrations/0002_profiles.sql",
    "docs/releases/0.2.0.ko.md",
  ].map((path) => ({ path }));
  const pack = {
    name: "rebut-mcp",
    version: "0.2.1",
    filename: "rebut-mcp-0.2.1.tgz",
    files,
  };
  expect(validatePack("v0.2.1", [pack])).toBe(pack);
  expect(() =>
    validatePack("v0.2.1", [{ ...pack, files: files.slice(1) }]),
  ).toThrow();
  for (const path of [
    ".env",
    "wrangler.private.json",
    "docs/guide/../../secret",
    "docs/guide/key.private.json",
    ".npmrc",
    "docs/guide/ko/.env",
    "docs/releases/archive/credentials.json",
    "src/private.ts",
  ])
    expect(() =>
      validatePack("v0.2.1", [{ ...pack, files: [...files, { path }] }]),
    ).toThrow();
});

it("requires a supported stable npm version and a forward-only latest release", () => {
  for (const version of ["11.5.1", "11.19.1", "12.0.0"])
    expect(() => validateNpmVersion(version)).not.toThrow();
  for (const version of ["11.5.0", "10.9.0", "11.5.1-pre", "warning\n11.19.1"])
    expect(() => validateNpmVersion(version)).toThrow();
  expect(() => validateAdvance("0.2.1", "0.2.0")).not.toThrow();
  expect(() => validateAdvance("1.0.0", "0.99.99")).not.toThrow();
  for (const version of ["0.2.0", "0.1.9"])
    expect(() => validateAdvance(version, "0.2.0")).toThrow();
});
