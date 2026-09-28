import { z } from 'zod';
import { HiggsfieldError } from './errors.js';

export const VIDEO_MODEL = 'bytedance/seedance-2.0/text-to-video';
export const IMAGE_MODEL = 'higgsfield-ai/soul/v2/standard';
// Limits on prompt/style length are this server's abuse safeguards, not provider limits.
const prompt = z.string().trim().min(1).max(20_000);
export const videoInputSchema = z.strictObject({
  prompt,
  duration: z.number().int().min(4).max(15).default(5),
  resolution: z.enum(['480p', '720p', '1080p', '4k']).default('720p'),
  aspect_ratio: z.enum(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']).default('16:9'),
  generate_audio: z.boolean().default(true),
});
export const imageInputSchema = z.strictObject({
  prompt,
  seed: z.number().int().min(1).max(1_000_000).nullable().optional(),
  style_id: z.string().min(1).max(200).optional(),
  batch_size: z.union([z.literal(1), z.literal(4)]).default(1),
  resolution: z.enum(['720p', '1080p']).default('720p'),
  aspect_ratio: z.enum(['9:16', '16:9', '4:3', '3:4', '1:1', '2:3', '3:2']).default('4:3'),
  enhance_prompt: z.boolean().default(true),
});
export type VideoInput = z.infer<typeof videoInputSchema>;
export type ImageInput = z.infer<typeof imageInputSchema>;
export type ModelKind = 'image' | 'video';

export const models = [
  { id: VIDEO_MODEL, name: 'Seedance 2.0', kind: 'video' as const, schema: videoInputSchema },
  { id: IMAGE_MODEL, name: 'Soul 2', kind: 'image' as const, schema: imageInputSchema },
];

export function listModels(kind?: ModelKind) {
  return {
    source: 'documented_supported_catalog', verified_on: '2026-09-28',
    account_access_verified: false,
    note: 'Supported adapters in this server, not the full live Higgsfield catalog. Account access and prices must be checked with Higgsfield.',
    models: models.filter(m => !kind || m.kind === kind).map(m => ({
      id: m.id, name: m.name, kind: m.kind,
      documentation: `https://open.higgsfield.ai/models/${m.id}/api-reference`,
      input_schema: z.toJSONSchema(m.schema, { io: 'input' }),
    })),
  };
}

export function validateModelInput(modelId: string, input: unknown, kind?: ModelKind): VideoInput | ImageInput {
  const model = models.find(m => m.id === modelId && (!kind || m.kind === kind));
  if (!model) throw new HiggsfieldError('UNSUPPORTED_MODEL');
  const result = model.schema.safeParse(input);
  if (!result.success) {
    throw new HiggsfieldError(result.error.issues.some(i => i.path[0] === 'prompt') ? 'INVALID_PROMPT' : 'INVALID_INPUT');
  }
  return result.data;
}
