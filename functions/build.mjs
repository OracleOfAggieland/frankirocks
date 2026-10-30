import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkg = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));

// Workspace packages (@franki/*) are bundled into dist. npm dependencies stay external,
// because Cloud Build installs them from this package.json at deploy time.
await build({
  entryPoints: [fileURLToPath(new URL("./src/index.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("./dist/index.js", import.meta.url)),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  external: Object.keys(pkg.dependencies ?? {}),
  logLevel: "info",
});
