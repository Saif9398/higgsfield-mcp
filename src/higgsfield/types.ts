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
export const estimateSchema = z.object({
  credits: z.string().regex(/^\d+(\.\d+)?$/),
  usd: z.string().regex(/^\d+(\.\d+)?$/),
});
export type GenerationRequest = z.infer<typeof requestSchema>;
export type CostEstimate = z.infer<typeof estimateSchema>;
export interface RequestLocator { request_id: string; status_url?: string }
