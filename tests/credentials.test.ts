import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { HiggsfieldClient } from '../src/higgsfield/client.js';
import { credentialSecrets } from '../src/higgsfield/credentials.js';
import { IMAGE_MODEL } from '../src/higgsfield/models.js';
import { createRedactor } from '../src/logger.js';
import { safeError } from '../src/higgsfield/errors.js';

describe('documented combined credentials', () => {
  it('loads HF_CREDENTIALS as one complete value', () => {
    expect(loadConfig({ HF_CREDENTIALS: '  fixture-id:fixture-secret  ' }).HF_CREDENTIALS).toBe('fixture-id:fixture-secret');
    expect(loadConfig({}).HF_CREDENTIALS).toBe('');
  });

  it('uses local defaults for blank environment template values', () => {
    expect(loadConfig({ HF_CREDENTIALS: '', PORT: '', HOST: '', AUTH_MODE: '', LOG_LEVEL: '', PUBLIC_URL: '' })).toMatchObject({
      HF_CREDENTIALS: '', PORT: 3000, HOST: '127.0.0.1', AUTH_MODE: 'local', LOG_LEVEL: 'info',
    });
  });

  it.each(['opaque-value', 'fixture-id:', ':fixture-secret', 'id:secret:extra', 'Key id:secret', 'Bearer id:secret', 'id:secret\r\nX-Injected: value'])('rejects unsupported/malformed format %j before HTTP', async credentials => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new HiggsfieldClient({ credentials, fetch: fetcher });
    await expect(client.estimateCost(IMAGE_MODEL, { prompt: 'Portrait' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => loadConfig({ HF_CREDENTIALS: credentials })).toThrow(expect.objectContaining({ code: 'INVALID_CREDENTIALS' }));
  });

  it('sends the complete value unchanged with exactly one Key prefix', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ credits: '1', usd: '0.1' })));
    const client = new HiggsfieldClient({ credentials: 'fixture-id:fixture-secret', fetch: fetcher });
    await client.estimateCost(IMAGE_MODEL, { prompt: 'Portrait' });
    expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({ Authorization: 'Key fixture-id:fixture-secret' });
  });

  it('redacts full credentials, individual components and credential-named fields', () => {
    const redact = createRedactor(credentialSecrets('fixture-id:fixture-secret'));
    const result = JSON.stringify(redact({
      message: 'fixture-id:fixture-secret fixture-id fixture-secret fixture-id%3Afixture-secret',
      nested: { credentials: 'different-value', HF_CREDENTIALS: 'other-value' },
    }));
    expect(result).not.toMatch(/fixture-id|fixture-secret|different-value|other-value/);
  });

  it('does not echo malformed credentials in errors', () => {
    try {
      loadConfig({ HF_CREDENTIALS: 'opaque-sensitive-fixture' });
      throw new Error('Expected validation failure');
    } catch (error) {
      const publicError = safeError(error);
      expect(publicError.code).toBe('INVALID_CREDENTIALS');
      expect(JSON.stringify(publicError)).not.toContain('opaque-sensitive-fixture');
      expect(String(error)).not.toContain('opaque-sensitive-fixture');
    }
  });
});
