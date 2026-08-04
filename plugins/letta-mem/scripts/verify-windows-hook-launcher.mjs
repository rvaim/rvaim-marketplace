import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  process.stdout.write("Windows Hook launcher verification skipped.\n");
  process.exit(0);
}

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const launcher = join(pluginRoot, "bin", "letta-mem-hook-launcher.exe");
const directory = mkdtempSync(join(tmpdir(), "letta-mem-hook-stress-"));
const fixture = join(directory, "echo.cjs");

function runOnce(index) {
  const input = JSON.stringify({
    id: index,
    text: "并发中文 <&> !@#$%^&*()",
    payload: "记忆".repeat(4_096),
  });
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(launcher, [process.execPath, fixture], {
      env: { ...process.env, TEMP: directory, TMP: directory },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error(`Hook ${index} timed out`));
    }, 15_000);
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      const actualStdout = Buffer.concat(stdout).toString("utf8");
      const actualStderr = Buffer.concat(stderr).toString("utf8");
      if (code !== 0 || actualStdout !== input || actualStderr !== "") {
        rejectPromise(new Error(
          `Hook ${index} mismatch: code=${String(code)} stdout=${actualStdout.length} stderr=${actualStderr.length}`,
        ));
        return;
      }
      resolvePromise();
    });
    child.stdin.end(input);
  });
}

try {
  writeFileSync(
    fixture,
    [
      'const { readFileSync } = require("node:fs");',
      "const chunks = [];",
      "process.stdin.on(\"data\", (chunk) => chunks.push(Buffer.from(chunk)));",
      "process.stdin.on(\"end\", () => process.stdout.write(Buffer.concat(chunks)));",
    ].join("\n"),
    "utf8",
  );

  for (let offset = 0; offset < 100; offset += 10) {
    await Promise.all(Array.from(
      { length: 10 },
      (_, index) => runOnce(offset + index),
    ));
  }

  const leftovers = readdirSync(directory).filter(
    (name) => name.startsWith("letta-mem-hook-") && name.endsWith(".tmp"),
  );
  if (leftovers.length > 0) {
    throw new Error(`Temporary Hook files were not cleaned: ${leftovers.join(", ")}`);
  }
  if (!readFileSync(fixture, "utf8").includes("process.stdout.write")) {
    throw new Error("Stress fixture changed unexpectedly");
  }
  process.stdout.write("Windows Hook launcher: 100 invocations passed in batches of 10.\n");
} finally {
  rmSync(directory, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}
