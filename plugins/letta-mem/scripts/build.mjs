import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const outputs = [
  "dist/letta-mem.mjs",
  "dist/letta-mem-mcp.mjs",
];

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22.19",
  minify: false,
  sourcemap: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/cli.ts"],
    outfile: "dist/letta-mem.mjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/mcp-cli.ts"],
    outfile: "dist/letta-mem-mcp.mjs",
  }),
]);

await Promise.all(outputs.map(async (path) => {
  const source = await readFile(path, "utf8");
  await writeFile(path, source.replace(/[ \t]+$/gm, ""), "utf8");
}));
