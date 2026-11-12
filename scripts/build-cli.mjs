import { build } from "esbuild";
await build({
  entryPoints: ["src/cli.ts"],
  outfile: "lib/cli.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  sourcemap: false,
});
