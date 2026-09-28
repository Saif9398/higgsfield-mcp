import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { HiggsfieldClient } from '../higgsfield/client.js';
import { imageInputSchema, videoInputSchema, IMAGE_MODEL, VIDEO_MODEL } from '../higgsfield/models.js';
import { safeError } from '../higgsfield/errors.js';

const outputSchema = z.object({
  ok: z.boolean(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: z.string(), message: z.string(), retry_after_seconds: z.number().optional() }).optional(),
});
const locator = { request_id: z.uuid(), status_url: z.url().optional().describe('Pass status_url from submission when available. Only the official status URL for this request is accepted.') };

export function createMcpServer(client: HiggsfieldClient, logger: Logger, scope?: string) {
  const server = new McpServer({ name: 'higgsfield-mcp', version: '1.0.0' }, {
    instructions: 'List supported models and estimate cost before generation. Generation spends the server owner’s Higgsfield balance. Submit once, retain request_id and status_url, then check status/result. Never repeat a timed-out submission without checking the Higgsfield console. Outputs are temporary; save completed media for long-term use.',
  });
  const metadata = (readOnly: boolean) => ({
    outputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: true },
    _meta: { securitySchemes: scope ? [{ type: 'oauth2', scopes: [scope] }] : [{ type: 'noauth' }] },
  });
  async function run(tool: string, action: () => Promise<object> | object) {
    const started = Date.now();
    try {
      const data = await action();
      const structuredContent = { ok: true, data: data as Record<string, unknown> };
      logger.info({ event: 'tool_completed', tool, duration_ms: Date.now() - started });
      return { structuredContent, content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }] };
    } catch (cause) {
      const error = safeError(cause);
      logger.warn({ event: 'tool_failed', tool, code: error.code, duration_ms: Date.now() - started });
      const structuredContent = { ok: false, error };
      return { isError: true, structuredContent, content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }] };
    }
  }

  server.registerTool('hf_list_models', {
    title: 'List supported Higgsfield models',
    description: 'List this server’s verified model adapters and input schemas. This is a local supported catalog, not account-specific live discovery.',
    inputSchema: z.strictObject({ kind: z.enum(['video', 'image']).optional() }), ...metadata(true),
  }, ({ kind }) => run('hf_list_models', () => client.listModels(kind)));

  server.registerTool('hf_estimate_cost', {
    title: 'Estimate Higgsfield generation cost',
    description: 'Ask Higgsfield for an account-specific estimate before generating. Pass a supported model ID and its input parameters. Does not submit a generation.',
    inputSchema: z.strictObject({ model: z.string().min(1).max(200), input: z.record(z.string(), z.unknown()).describe('Model parameters from hf_list_models. Validated against the selected model before sending.') }), ...metadata(true),
  }, ({ model, input }, ctx) => run('hf_estimate_cost', () => client.estimateCost(model, input, ctx.mcpReq.signal)));

  server.registerTool('hf_generate_video', {
    title: 'Generate a Higgsfield video',
    description: 'Spend Higgsfield balance to submit one asynchronous video generation. Returns request_id immediately; use status/result tools afterwards. Do not repeat an ambiguous submission.',
    inputSchema: z.strictObject({ model: z.string().max(200).default(VIDEO_MODEL), input: videoInputSchema }), ...metadata(false),
  }, ({ model, input }, ctx) => run('hf_generate_video', () => client.generate('video', model, input, ctx.mcpReq.signal)));

  server.registerTool('hf_generate_image', {
    title: 'Generate Higgsfield images',
    description: 'Spend Higgsfield balance to submit one asynchronous image generation. Returns request_id immediately; use status/result tools afterwards. Do not repeat an ambiguous submission.',
    inputSchema: z.strictObject({ model: z.string().max(200).default(IMAGE_MODEL), input: imageInputSchema }), ...metadata(false),
  }, ({ model, input }, ctx) => run('hf_generate_image', () => client.generate('image', model, input, ctx.mcpReq.signal)));

  server.registerTool('hf_get_generation_status', {
    title: 'Check Higgsfield generation status',
    description: 'Check an existing request once. Returns queued, in_progress, completed, failed, nsfw or canceled; completed status can include media URLs.',
    inputSchema: z.strictObject(locator), ...metadata(true),
  }, (input, ctx) => run('hf_get_generation_status', () => client.getStatus(input, ctx.mcpReq.signal)));

  server.registerTool('hf_get_generation_result', {
    title: 'Get Higgsfield generation results',
    description: 'Retrieve media URLs for an existing generation. By default checks once; optionally poll for at most 25 seconds. A timeout does not cancel the generation. Reuse the same request_id later.',
    inputSchema: z.strictObject({ ...locator, wait_seconds: z.number().int().min(0).max(25).default(0) }), ...metadata(true),
  }, ({ wait_seconds, ...input }, ctx) => run('hf_get_generation_result', () => client.getResult(input, wait_seconds, ctx.mcpReq.signal)));

  return server;
}
