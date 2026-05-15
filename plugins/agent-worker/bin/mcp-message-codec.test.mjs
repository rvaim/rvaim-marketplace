import test from "node:test";
import assert from "node:assert/strict";

import { McpMessageParser, serializeMcpMessage } from "./mcp-message-codec.mjs";

test("parses JSONL MCP messages", () => {
  const messages = [];
  const framings = [];
  const parser = new McpMessageParser((message, framing) => {
    messages.push(message);
    framings.push(framing);
  });

  parser.push(Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n'));

  assert.deepEqual(messages, [
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  ]);
  assert.deepEqual(framings, ["jsonl"]);
});

test("parses Content-Length MCP messages", () => {
  const messages = [];
  const framings = [];
  const parser = new McpMessageParser((message, framing) => {
    messages.push(message);
    framings.push(framing);
  });
  const body = '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{}}';

  parser.push(Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`));

  assert.deepEqual(messages, [
    { jsonrpc: "2.0", id: 2, method: "initialize", params: {} },
  ]);
  assert.deepEqual(framings, ["content-length"]);
});

test("serializes MCP messages as JSONL or Content-Length", () => {
  const message = { jsonrpc: "2.0", id: 3, result: { ok: true } };
  const body = JSON.stringify(message);

  assert.equal(serializeMcpMessage(message, "jsonl").toString("utf8"), `${body}\n`);
  assert.equal(
    serializeMcpMessage(message, "content-length").toString("utf8"),
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
});
