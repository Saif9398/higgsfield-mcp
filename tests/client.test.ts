import { afterEach, describe, expect, it, vi } from 'vitest';
import { HiggsfieldClient } from '../src/higgsfield/client.js';
import { IMAGE_MODEL, VIDEO_MODEL } from '../src/higgsfield/models.js';
import { createRedactor } from '../src/logger.js';

const id = 'd7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff';
const queued = { request_id: id, status: 'queued', status_url: `https://api.higgsfield.ai/requests/${id}/status` };
const response = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });
const setup = (fetcher = vi.fn<typeof fetch>(), options = {}) => ({ fetcher, client: new HiggsfieldClient({ credentials: 'test-key-id:test-key-secret', fetch: fetcher, ...options }) });
afterEach(() => vi.useRealTimers());

describe('Higgsfield REST contracts', () => {
  it('submits asynchronously with documented auth, model route and defaults', async () => {
    const { client, fetcher } = setup(); fetcher.mockResolvedValue(response(queued));
    expect(await client.generate('video', VIDEO_MODEL, { prompt: 'A coastal road' })).toEqual(queued);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`https://api.higgsfield.ai/${VIDEO_MODEL}`);
    expect(init?.headers).toMatchObject({ Authorization: 'Key test-key-id:test-key-secret' });
    expect(init?.redirect).toBe('error');
    expect(JSON.parse(init!.body as string)).toEqual({ prompt: 'A coastal road', duration: 5, resolution: '720p', aspect_ratio: '16:9', generate_audio: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses the estimate endpoint and decimal strings without generating', async () => {
    const { client, fetcher } = setup(); fetcher.mockResolvedValue(response({ credits: '1.500', usd: '0.094' }));
    expect(await client.estimateCost(IMAGE_MODEL, { prompt: 'Portrait' })).toEqual({ credits: '1.500', usd: '0.094' });
    expect(fetcher.mock.calls[0]![0]).toBe(`https://api.higgsfield.ai/estimate/${IMAGE_MODEL}`);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({ batch_size: 1, enhance_prompt: true });
  });
  it('retrieves results through the status route, with no invented result endpoint', async () => {
    const { client, fetcher } = setup(); fetcher.mockResolvedValue(response({ request_id: id, status: 'completed', images: [{ url: 'https://cdn.example.com/image.jpg' }], secret: 'test-key-secret' }));
    expect(await client.getResult({ request_id: id })).toEqual({ request_id: id, status: 'completed', images: [{ url: 'https://cdn.example.com/image.jpg' }], ready: true });
    expect(fetcher.mock.calls[0]![0]).toBe(queued.status_url);
  });
  it('reports unfinished work without waiting by default', async () => {
    const { client, fetcher } = setup(); fetcher.mockResolvedValue(response(queued));
    expect(await client.getResult({ request_id: id })).toMatchObject({ ready: false, poll_after_seconds: 2 });
  });
  it.each([
    [401, 'INVALID_CREDENTIALS'], [403, 'INSUFFICIENT_BALANCE'], [402, 'INSUFFICIENT_BALANCE'],
    [404, 'UNSUPPORTED_MODEL'], [422, 'INVALID_INPUT'], [400, 'INVALID_INPUT'],
    [429, 'RATE_LIMITED'], [500, 'UPSTREAM_UNAVAILABLE'], [503, 'UPSTREAM_UNAVAILABLE'],
  ])('maps HTTP %i without leaking upstream detail or retrying a POST', async (status, code) => {
    const { client, fetcher } = setup(); fetcher.mockResolvedValue(response({ detail: 'test-key-secret' }, status as number));
    await expect(client.generate('image', IMAGE_MODEL, { prompt: 'Portrait' })).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['failed', 'GENERATION_FAILED'], ['nsfw', 'CONTENT_REJECTED'], ['canceled', 'GENERATION_CANCELED'],
  ])('stops on terminal %s', async (status, code) => {
    const { client, fetcher } = setup(); fetcher.mockResolvedValue(response({ request_id: id, status, error: 'test-key-secret' }));
    await expect(client.getResult({ request_id: id }, 25)).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps failed status inspectable, stripping raw provider error', async () => {
    const { client, fetcher } = setup(); fetcher.mockResolvedValue(response({ request_id: id, status: 'failed', error: 'test-key-secret' }));
    expect(await client.getStatus({ request_id: id })).toEqual({ request_id: id, status: 'failed' });
  });
  it('rejects unsupported models, wrong kind, invalid prompts and unknown parameters before HTTP', async () => {
    const { client, fetcher } = setup();
    await expect(client.generate('image', 'unknown/model', { prompt: 'x' })).rejects.toMatchObject({ code: 'UNSUPPORTED_MODEL' });
    await expect(client.generate('video', IMAGE_MODEL, { prompt: 'x' })).rejects.toMatchObject({ code: 'UNSUPPORTED_MODEL' });
    await expect(client.generate('image', IMAGE_MODEL, { prompt: '  ' })).rejects.toMatchObject({ code: 'INVALID_PROMPT' });
    await expect(client.generate('video', VIDEO_MODEL, { prompt: 'x', duration: 100 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(client.generate('image', IMAGE_MODEL, { prompt: 'x', arbitrary: true })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['https://evil.example/status', `https://api.higgsfield.ai/requests/${id}/status?secret=1`, 'http://api.higgsfield.ai/status', 'https://api.higgsfield.ai/other'])('rejects untrusted status URL %s', async status_url => {
    const { client, fetcher } = setup();
    await expect(client.getStatus({ request_id: id, status_url })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects malformed responses, mismatched IDs and completed results without media', async () => {
    const { client, fetcher } = setup();
    fetcher.mockResolvedValueOnce(response({ status: 'surprise' }));
    await expect(client.getStatus({ request_id: id })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    fetcher.mockResolvedValueOnce(response({ ...queued, request_id: 'a7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff' }));
    await expect(client.getStatus({ request_id: id })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    fetcher.mockResolvedValueOnce(response({ request_id: id, status: 'completed' }));
    await expect(client.getResult({ request_id: id })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('never retries ambiguous generation network failures', async () => {
    const { client, fetcher } = setup(); fetcher.mockRejectedValue(new Error('test-key-secret'));
    await expect(client.generate('image', IMAGE_MODEL, { prompt: 'x' })).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retries GET transient failures within a bounded attempt count', async () => {
    vi.useFakeTimers(); const { client, fetcher } = setup();
    fetcher.mockResolvedValueOnce(response({}, 500)).mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(response(queued));
    const pending = client.getStatus({ request_id: id });
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(queued); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('honors retry-after and avoids a long blocking wait', async () => {
    const { client, fetcher } = setup(); fetcher.mockResolvedValue(response({}, 429, { 'Retry-After': '60' }));
    await expect(client.getStatus({ request_id: id })).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 60 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('times out an in-flight HTTP operation and never resubmits it', async () => {
    const { client, fetcher } = setup(vi.fn<typeof fetch>(), { requestTimeoutMs: 15 });
    fetcher.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    await expect(client.generate('image', IMAGE_MODEL, { prompt: 'x' })).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds polling by the requested wall-clock deadline', async () => {
    const { client, fetcher } = setup(); fetcher.mockImplementation(async () => response(queued));
    const start = Date.now();
    await expect(client.getResult({ request_id: id }, 1)).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(Date.now() - start).toBeLessThan(1500);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('handles caller cancellation without sending a request', async () => {
    const { client, fetcher } = setup();
    await expect(client.getStatus({ request_id: id }, AbortSignal.abort())).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('fails safely when credentials are missing', async () => {
    const { client, fetcher } = setup(vi.fn<typeof fetch>(), { credentials: '' });
    await expect(client.estimateCost(IMAGE_MODEL, { prompt: 'x' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('redacts nested credentials and authorization values', () => {
    const redact = createRedactor(['sensitive-value']);
    expect(JSON.stringify(redact({ nested: { msg: 'sensitive-value', authorization: 'Bearer abc', api_key: 'xyz' } }))).not.toMatch(/sensitive-value|abc|xyz/);
  });
});
