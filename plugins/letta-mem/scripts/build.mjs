import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22.19",
  external: ["@letta-ai/letta-agent-sdk"],
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
