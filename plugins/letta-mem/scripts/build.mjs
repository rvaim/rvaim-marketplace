import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/letta-mem.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22.19",
  external: [
    "@letta-ai/letta-agent-sdk",
    "@letta-ai/letta-code/app-server-client",
  ],
  minify: false,
  sourcemap: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
