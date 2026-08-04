import {
  executeHookAction,
  MAX_HOOK_INPUT_BYTES,
  recoverHookError,
} from "./hook-runtime.js";

async function readInput(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_HOOK_INPUT_BYTES) {
      throw new Error("Hook 输入超过 2 MB 限制");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  let output = "";
  try {
    output = await executeHookAction(process.argv[2], await readInput());
  } catch (error) {
    output = recoverHookError(error);
  }
  if (output) process.stdout.write(output);
}

await main();

// 结束一次性 Hook 进程中可能仍被 SDK 管理连接持有的套接字；
// App Server 是独立的用户服务，退出该进程不会停止它。
const exitTimer = setTimeout(() => process.exit(process.exitCode ?? 0), 50);
exitTimer.unref();
