import { z } from 'zod';
import { credentialsSchema } from './higgsfield/credentials.js';
import { HiggsfieldError } from './higgsfield/errors.js';

const httpsUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
});
const schema = z.object({
  HF_CREDENTIALS: z.string().trim().default('').refine(value => value === '' || credentialsSchema.safeParse(value).success),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  AUTH_MODE: z.enum(['local', 'oauth']).default('local'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),
  PUBLIC_URL: httpsUrl.optional(),
  OAUTH_ISSUER: httpsUrl.optional(),
  OAUTH_JWKS_URL: httpsUrl.optional(),
  OAUTH_ALLOWED_SUBJECTS: z.string().optional(),
  OAUTH_SCOPE: z.string().regex(/^[a-zA-Z0-9:_-]+$/).default('higgsfield:use'),
  ALLOWED_ORIGINS: z.string().default(''),
}).superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (value.AUTH_MODE === 'local' && (!['127.0.0.1', '::1'].includes(value.HOST) || value.NODE_ENV === 'production')) {
    issue('Local mode requires a loopback HOST and a non-production NODE_ENV.');
  }
  if (value.AUTH_MODE === 'oauth') {
    if (!value.PUBLIC_URL || !value.OAUTH_ISSUER || !value.OAUTH_JWKS_URL || !value.OAUTH_ALLOWED_SUBJECTS?.trim()) {
      issue('OAuth mode requires PUBLIC_URL, OAUTH_ISSUER, OAUTH_JWKS_URL and OAUTH_ALLOWED_SUBJECTS.');
    }
    if (value.PUBLIC_URL && new URL(value.PUBLIC_URL).pathname !== '/') issue('PUBLIC_URL must contain only the public origin.');
    if (!value.HF_CREDENTIALS) issue('OAuth mode requires Higgsfield credentials.');
  }
  for (const origin of value.ALLOWED_ORIGINS.split(',').filter(Boolean)) {
    try { if (new URL(origin).origin !== origin) issue('ALLOWED_ORIGINS requires exact origins.'); }
    catch { issue('ALLOWED_ORIGINS requires valid origins.'); }
  }
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Blank placeholders in .env.example use the same defaults as absent values.
  const normalized = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value?.trim() === '' ? undefined : value]));
  const result = schema.safeParse(normalized);
  if (!result.success) {
    if (result.error.issues.some(issue => issue.path[0] === 'HF_CREDENTIALS')) throw new HiggsfieldError('INVALID_CREDENTIALS');
    // Do not include Zod's raw input or enum error values (which could contain secrets).
    throw new Error('Invalid server configuration. Check .env.example and DEPLOYMENT.md.');
  }
  return result.data;
}
