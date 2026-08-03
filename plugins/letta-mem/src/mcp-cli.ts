import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRecallMcpServer } from "./mcp.js";

const server = createRecallMcpServer();
const transport = new StdioServerTransport();

try {
  await server.connect(transport);
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`letta-mem MCP 启动失败：${detail}\n`);
  process.exitCode = 1;
}
