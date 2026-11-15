import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSynapseMcpServer } from "../src/mcp/server.js";

describe("SYNAPSE MCP server", () => {
  let client: Client | undefined;
  let server: ReturnType<typeof createSynapseMcpServer> | undefined;
  let clientTransport: InMemoryTransport | undefined;
  let serverTransport: InMemoryTransport | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
    await clientTransport?.close();
    await serverTransport?.close();
    client = undefined;
    server = undefined;
    clientTransport = undefined;
    serverTransport = undefined;
  });

  async function connect() {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createSynapseMcpServer({ apiBaseUrl: "http://127.0.0.1:1" });
    client = new Client({ name: "synapse-mcp-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return client;
  }

  it("advertises the workflow compile, preview, run, and comparison tools", async () => {
    const connection = await connect();
    const result = await connection.listTools();
    const names = result.tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "synapse_list_workflows",
        "synapse_compile_workflow",
        "synapse_preview_optimization",
        "synapse_import_workflow",
        "synapse_start_workflow_run",
        "synapse_get_run_result",
        "synapse_compare_runs",
      ]),
    );
  });

  it("rejects malformed workflow JSON without calling the backend", async () => {
    const connection = await connect();
    const result = await connection.callTool({
      name: "synapse_compile_workflow",
      arguments: { workflowJson: "{x" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]).toMatchObject({ type: "text" });
    expect(content[0].text).toContain("not valid JSON");
  });
});
