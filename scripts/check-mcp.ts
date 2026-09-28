import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
const client = new Client({ name: 'higgsfield-smoke-check', version: '1.0.0' });
try {
  const url = new URL(process.env.MCP_URL ?? 'http://127.0.0.1:3000/mcp');
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: process.env.MCP_ACCESS_TOKEN ? { headers: { Authorization: `Bearer ${process.env.MCP_ACCESS_TOKEN}` } } : undefined,
  });
  await client.connect(transport);
  const result = await client.listTools();
  const names = result.tools.map(t => t.name).sort();
  const expected = ['hf_estimate_cost', 'hf_generate_image', 'hf_generate_video', 'hf_get_generation_result', 'hf_get_generation_status', 'hf_list_models'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('Unexpected tool list');
  const catalog = await client.callTool({ name: 'hf_list_models', arguments: {} });
  if (catalog.isError) throw new Error('Catalog call failed');
  console.log(JSON.stringify({ connected: true, tools: names, catalog_call_ok: true }, null, 2));
} catch { console.error('MCP check failed. Verify URL, server status and OAuth access token when required.'); process.exitCode = 1; }
finally { await client.close(); }
