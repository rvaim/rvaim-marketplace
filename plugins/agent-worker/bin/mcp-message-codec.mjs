const HEADER_SEPARATOR = Buffer.from("\r\n\r\n");

export function serializeMcpMessage(message, framing = "jsonl") {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (framing === "content-length") {
    return Buffer.concat([
      Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"),
      body,
    ]);
  }
  return Buffer.concat([body, Buffer.from("\n", "utf8")]);
}

export class McpMessageParser {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.buffer = Buffer.alloc(0);
    this.framing = null;
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length > 0) {
      if (!this.framing) {
        this.framing = this.detectFraming();
        if (!this.framing) return;
      }

      const parsed = this.framing === "content-length"
        ? this.readContentLengthMessage()
        : this.readJsonLineMessage();
      if (!parsed) return;

      this.onMessage(parsed.message, this.framing);
    }
  }

  detectFraming() {
    const firstNewline = this.buffer.indexOf("\n");
    const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR);

    if (headerEnd !== -1 && (firstNewline === -1 || headerEnd < firstNewline)) {
      return "content-length";
    }

    if (firstNewline !== -1) return "jsonl";
    return null;
  }

  readContentLengthMessage() {
    const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR);
    if (headerEnd === -1) return null;

    const headerText = this.buffer.subarray(0, headerEnd).toString("utf8");
    const match = headerText.match(/content-length:\s*(\d+)/i);
    if (!match) throw new Error("missing Content-Length header in MCP frame");

    const contentLength = Number.parseInt(match[1], 10);
    const bodyStart = headerEnd + HEADER_SEPARATOR.length;
    const frameLength = bodyStart + contentLength;
    if (this.buffer.length < frameLength) return null;

    const bodyText = this.buffer.subarray(bodyStart, frameLength).toString("utf8");
    this.buffer = this.buffer.subarray(frameLength);
    return { message: JSON.parse(bodyText) };
  }

  readJsonLineMessage() {
    const lineEnd = this.buffer.indexOf("\n");
    if (lineEnd === -1) return null;

    const line = this.buffer.subarray(0, lineEnd).toString("utf8").replace(/\r$/, "");
    this.buffer = this.buffer.subarray(lineEnd + 1);
    if (!line.trim()) return { message: null };
    return { message: JSON.parse(line) };
  }
}
