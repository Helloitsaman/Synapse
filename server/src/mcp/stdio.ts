import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSynapseMcpServer } from "./server.js";

async function main() {
  const server = createSynapseMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for MCP JSON-RPC. Keep diagnostics on stderr.
  console.error("SYNAPSE MCP server connected over stdio.");
}

main().catch((error) => {
  console.error("SYNAPSE MCP server failed to start:", error);
  process.exitCode = 1;
});
