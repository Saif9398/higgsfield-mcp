import { z } from 'zod';

// Official TypeScript setup: HF_CREDENTIALS="KEY_ID:KEY_SECRET".
// This is one combined credential, not a documented standalone bearer token.
export const credentialsSchema = z.string().regex(/^[^:\s]+:[^:\s]+$/);

export function credentialSecrets(credentials: string): string[] {
  // Redact the complete value and either component if upstream echoes one alone.
  return [credentials, ...credentials.split(':')].filter(Boolean);
}
