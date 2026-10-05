import { z } from 'zod';

const media = z.object({ url: z.url().refine(v => new URL(v).protocol === 'https:') });
export const requestSchema = z.object({
  request_id: z.uuid(),
  status: z.enum(['queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled']),
  status_url: z.url().optional(),
  cancel_url: z.url().optional(),
  images: z.array(media).optional(),
  video: media.optional(),
  // Provider error text is deliberately not forwarded. Unknown fields are stripped.
});
const estimateAmount = z.union([
  z.string().regex(/^\d+(\.\d+)?$/),
  z.number().finite().nonnegative().transform(value => String(value)),
]);
const fixedEstimateSchema = z.object({
  credits: estimateAmount,
  usd: estimateAmount,
});
const descriptionEstimateSchema = z.object({
  type: z.literal('description'),
  pricing_description: z.string().trim().min(1).max(4000),
});
export const estimateSchema = z.union([fixedEstimateSchema, descriptionEstimateSchema]);
export type GenerationRequest = z.infer<typeof requestSchema>;
export type CostEstimate = z.infer<typeof estimateSchema>;
export interface RequestLocator { request_id: string; status_url?: string }
