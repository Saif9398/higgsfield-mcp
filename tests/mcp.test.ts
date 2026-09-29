import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createMcpServer } from '../src/mcp/tools.js';
import { HiggsfieldClient } from '../src/higgsfield/client.js';
import { IMAGE_MODEL, VIDEO_MODEL } from '../src/higgsfield/models.js';
import { createLogger } from '../src/logger.js';

describe('MCP tool protocol', () => {
  const id = 'd7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff';
  let mcp: Client;
  let handler: ReturnType<typeof createMcpHandler>;
  const fetcher = vi.fn<typeof fetch>();
  beforeEach(async () => {
    fetcher.mockReset();
    const hf = new HiggsfieldClient({ credentials: 'test-id:test-secret', fetch: fetcher });
    handler = createMcpHandler(() => createMcpServer(hf, createLogger([], 'silent')));
    mcp = new Client({ name: 'test-client', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    }));
  });
  afterEach(async () => { await mcp.close(); await handler.close(); });
  it('discovers all six tools with schemas and accurate cost annotations', async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(['hf_estimate_cost', 'hf_generate_image', 'hf_generate_video', 'hf_get_generation_result', 'hf_get_generation_status', 'hf_list_models']);
    for (const tool of tools) { expect(tool.inputSchema.type).toBe('object'); expect(tool.outputSchema).toBeDefined(); }
    expect(tools.find(t => t.name === 'hf_generate_image')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
  });
  it('lists documented models without provider credentials/network calls', async () => {
    const result = await mcp.callTool({ name: 'hf_list_models', arguments: { kind: 'image' } });
    expect(result.structuredContent).toMatchObject({ ok: true, data: { source: 'documented_supported_catalog', models: [{ id: IMAGE_MODEL }] } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['hf_generate_image', 'hf_generate_video'])('submits %s and returns an ID, without polling', async name => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ request_id: id, status: 'queued' })));
    const result = await mcp.callTool({ name, arguments: { input: { prompt: 'An ocean view' } } });
    expect(result.structuredContent).toMatchObject({ ok: true, data: { request_id: id, status: 'queued' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('estimates image inputs using image defaults', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ credits: '1', usd: '0.1' })));
    const result = await mcp.callTool({ name: 'hf_estimate_cost', arguments: { model: IMAGE_MODEL, input: { prompt: 'Portrait' } } });
    expect(result.structuredContent).toMatchObject({ ok: true, data: { usd: '0.1' } });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).not.toHaveProperty('duration');
  });
  it('returns Seedance token pricing without inventing a numeric quote', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ type: 'description', pricing_description: 'Token-metered pricing. Rates shown are before any applicable customer discount.' })));
    const result = await mcp.callTool({ name: 'hf_estimate_cost', arguments: { model: VIDEO_MODEL, input: {
      prompt: 'A cinematic city street at dusk', duration: 5, resolution: '720p', aspect_ratio: '9:16', generate_audio: true,
    } } });
    expect(result.structuredContent).toEqual({ ok: true, data: {
      type: 'description', pricing_description: 'Token-metered pricing. Rates shown are before any applicable customer discount.',
    } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe(`https://api.higgsfield.ai/estimate/${VIDEO_MODEL}`);
  });
  it.each(['hf_get_generation_status', 'hf_get_generation_result'])('retrieves %s through status endpoint', async name => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ request_id: id, status: 'completed', video: { url: 'https://cdn.example.com/v.mp4' } })));
    const result = await mcp.callTool({ name, arguments: { request_id: id } });
    expect(result.structuredContent).toMatchObject({ ok: true, data: { status: 'completed' } });
  });
  it('rejects invalid tool input before accessing Higgsfield', async () => {
    const result = await mcp.callTool({ name: 'hf_generate_video', arguments: { input: { prompt: '', duration: 99 } } });
    expect(result.isError).toBe(true); expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns useful sanitized errors', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ detail: 'test-secret' }), { status: 401 }));
    const result = await mcp.callTool({ name: 'hf_generate_image', arguments: { input: { prompt: 'Portrait' } } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ ok: false, error: { code: 'INVALID_CREDENTIALS' } });
    expect(JSON.stringify(result)).not.toContain('test-secret');
  });
});
