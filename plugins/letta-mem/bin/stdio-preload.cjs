"use strict";

// 改写自 letta-ai/claude-subconscious 的 stdio-preload.cjs（MIT）；
// 上游归属与许可见 ../NOTICE.md 和 ../LICENSE。

const { closeSync, openSync, readFileSync, writeSync } = require("node:fs");

const stdinPath = process.env.LETTA_MEM_HOOK_STDIN_FILE;
const stdoutPath = process.env.LETTA_MEM_HOOK_STDOUT_FILE;
const stderrPath = process.env.LETTA_MEM_HOOK_STDERR_FILE;

if (stdinPath) {
  try {
    const input = readFileSync(stdinPath);
    process.stdin.pause();
    if (input.length > 0) process.stdin.unshift(input);
    process.nextTick(() => process.stdin.push(null));
  } catch {
    // 启动器会负责记录进程失败；预加载层保持故障开放。
  }
}

const descriptors = [];

function capture(stream, path) {
  if (!path) return;
  try {
    const descriptor = openSync(path, "a");
    descriptors.push(descriptor);
    const originalWrite = stream.write.bind(stream);
    stream.write = function write(chunk, encoding, callback) {
      try {
        const buffer = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(
            chunk,
            typeof encoding === "string" ? encoding : "utf8",
          );
        writeSync(descriptor, buffer);
      } catch {
        // 临时输出文件异常不能阻断 Hook 自身。
      }
      return originalWrite(chunk, encoding, callback);
    };
  } catch {
    // 临时输出文件异常不能阻断 Hook 自身。
  }
}

capture(process.stdout, stdoutPath);
capture(process.stderr, stderrPath);

process.once("exit", () => {
  for (const descriptor of descriptors) {
    try {
      closeSync(descriptor);
    } catch {
      // 退出清理仅处理本进程打开的精确句柄。
    }
  }
});
