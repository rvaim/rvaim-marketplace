#!/usr/bin/env node

const { join } = require("node:path");
const { spawn } = require("node:child_process");

const bootstrapPath = join(__dirname, "bootstrap.cjs");
const hookArguments = process.argv.slice(2);

if (process.platform !== "win32") {
  require(bootstrapPath);
} else {
  const launcherPath = join(__dirname, "letta-mem-hook-launcher.exe");
  const child = spawn(
    launcherPath,
    [process.execPath, bootstrapPath, ...hookArguments],
    {
      stdio: "inherit",
      windowsHide: true,
    },
  );
  child.once("error", (error) => {
    console.error(`Letta memory Hook launcher failed: ${String(error)}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}
