"use strict";

// 改写自 letta-ai/claude-subconscious 的 stdio-preload.cjs（MIT）；
// 上游归属与许可见 ../NOTICE.md 和 ../LICENSE。

const { closeSync, openSync, readFileSync, writeSync } = require("node:fs");
const { Readable } = require("node:stream");

if (
  process.platform === "win32"
  && /^(?:1|true)$/i.test(
    process.env.LETTA_MEM_HIDE_CHILD_WINDOWS || "",
  )
) {
  const { ChildProcess } = require("node:child_process");
  const originalSpawn = ChildProcess.prototype.spawn;
  ChildProcess.prototype.spawn = function spawn(options) {
    if (options && typeof options === "object") options.windowsHide = true;
    return originalSpawn.call(this, options);
  };
}

const stdinPath = process.env.LETTA_MEM_HOOK_STDIN_FILE;
const stdoutPath = process.env.LETTA_MEM_HOOK_STDOUT_FILE;
const stderrPath = process.env.LETTA_MEM_HOOK_STDERR_FILE;

if (stdinPath) {
  try {
    const input = readFileSync(stdinPath);
    const restoredInput = Readable.from(input.length > 0 ? [input] : []);
    Object.defineProperty(process, "stdin", {
      configurable: true,
      enumerable: true,
      value: restoredInput,
    });
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
