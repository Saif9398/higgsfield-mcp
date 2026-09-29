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
const decimalString = z.string().regex(/^\d+(\.\d+)?$/);
const decimal = z.union([
  decimalString,
  z.number().finite().nonnegative(),
]).transform(value => typeof value === 'number' ? String(value) : value);

export const estimateSchema = z.object({
  credits: decimal,
  usd: decimal,
});
export type GenerationRequest = z.infer<typeof requestSchema>;
export type CostEstimate = z.infer<typeof estimateSchema>;
export interface RequestLocator { request_id: string; status_url?: string }
