"use strict";

(async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const input = Buffer.concat(chunks).toString("utf8");
  process.stdout.write(`stdout:${input}`);
  process.stderr.write(`stderr:${input}`);
  process.exitCode = 7;
})();
