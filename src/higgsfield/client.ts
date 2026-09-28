import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import type { Logger } from 'pino';
import { createRedactor } from '../logger.js';
import { credentialSecrets, credentialsSchema } from './credentials.js';
import { HiggsfieldError, safeError } from './errors.js';
import { listModels, validateModelInput, type ModelKind } from './models.js';
import { estimateSchema, requestSchema, type RequestLocator, type GenerationRequest } from './types.js';

const BASE = 'https://api.higgsfield.ai';
export interface ClientOptions {
  credentials: string; logger?: Logger;
  fetch?: typeof globalThis.fetch; requestTimeoutMs?: number; maxRetries?: number;
}

export class HiggsfieldClient {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly redact: ReturnType<typeof createRedactor>;
  constructor(private readonly options: ClientOptions) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.redact = createRedactor(credentialSecrets(options.credentials));
  }

  listModels(kind?: ModelKind) { return listModels(kind); }

  async estimateCost(model: string, input: unknown, signal?: AbortSignal) {
    const payload = validateModelInput(model, input);
    return this.request(`/estimate/${model}`, 'POST', estimateSchema, payload, signal);
  }

  async generate(kind: ModelKind, model: string, input: unknown, signal?: AbortSignal) {
    const payload = validateModelInput(model, input, kind);
    const result = await this.request(`/${model}`, 'POST', requestSchema, payload, signal);
    if (result.status_url) this.statusPath(result);
    this.checkTerminal(result);
    return result;
  }

  private statusPath(locator: RequestLocator): string {
    if (!z.uuid().safeParse(locator.request_id).success) throw new HiggsfieldError('INVALID_INPUT');
    const path = `/requests/${locator.request_id}/status`;
    if (locator.status_url) {
      let url: URL;
      try { url = new URL(locator.status_url); } catch { throw new HiggsfieldError('INVALID_INPUT'); }
      // Never send credentials to response-provided hosts, redirects, or arbitrary paths.
      if (url.origin !== BASE || url.pathname !== path || url.search || url.hash || url.username || url.password) {
        throw new HiggsfieldError('INVALID_INPUT');
      }
      return url.pathname;
    }
    // Documented recovery route when only the durable request ID is available.
    return path;
  }

  async getStatus(locator: RequestLocator, signal?: AbortSignal): Promise<GenerationRequest> {
    const result = await this.request(this.statusPath(locator), 'GET', requestSchema, undefined, signal);
    if (result.request_id !== locator.request_id) throw new HiggsfieldError('INVALID_RESPONSE');
    if (result.status_url) this.statusPath(result);
    return result;
  }

  async getResult(locator: RequestLocator, waitSeconds = 0, signal?: AbortSignal) {
    if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 25) throw new HiggsfieldError('INVALID_INPUT');
    const deadline = Date.now() + waitSeconds * 1000;
    const bounded = waitSeconds > 0 ? AbortSignal.any([AbortSignal.timeout(waitSeconds * 1000), ...(signal ? [signal] : [])]) : signal;
    let interval = 2000;
    for (;;) {
      if (waitSeconds > 0 && Date.now() >= deadline) throw new HiggsfieldError('TIMEOUT');
      const result = await this.getStatus(locator, bounded);
      this.checkTerminal(result);
      if (result.status === 'completed') {
        if (!result.video && !result.images?.length) throw new HiggsfieldError('INVALID_RESPONSE');
        return { ...result, ready: true };
      }
      if (waitSeconds === 0) return { ...result, ready: false, poll_after_seconds: 2 };
      if (Date.now() >= deadline) throw new HiggsfieldError('TIMEOUT');
      try { await sleep(Math.min(interval + Math.random() * 500, deadline - Date.now()), undefined, { signal: bounded }); }
      catch { throw new HiggsfieldError('TIMEOUT'); }
      interval = Math.min(interval * 1.5, 10_000);
    }
  }

  private checkTerminal(result: GenerationRequest) {
    if (result.status === 'failed') throw new HiggsfieldError('GENERATION_FAILED');
    if (result.status === 'nsfw') throw new HiggsfieldError('CONTENT_REJECTED');
    if (result.status === 'canceled') throw new HiggsfieldError('GENERATION_CANCELED');
  }

  private async request<T>(path: string, method: 'GET' | 'POST', schema: z.ZodType<T>, payload?: unknown, callerSignal?: AbortSignal): Promise<T> {
    if (!credentialsSchema.safeParse(this.options.credentials).success) throw new HiggsfieldError('INVALID_CREDENTIALS');
    const timeout = AbortSignal.timeout(this.options.requestTimeoutMs ?? 15_000);
    const signal = AbortSignal.any([timeout, ...(callerSignal ? [callerSignal] : [])]);
    const retries = method === 'GET' ? Math.min(this.options.maxRetries ?? 2, 3) : 0;
    for (let attempt = 0; ; attempt++) {
      let correlationId: string | undefined;
      try {
        signal.throwIfAborted();
        const response = await this.fetcher(`${BASE}${path}`, {
          method, redirect: 'error', signal,
          headers: { Authorization: `Key ${this.options.credentials}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        correlationId = response.headers.get('x-correlation-id')?.slice(0, 200);
        if (!response.ok) {
          await response.body?.cancel();
          const status = response.status;
          const retry = response.headers.get('retry-after');
          const seconds = retry ? (/^\d+$/.test(retry) ? Number(retry) : Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000))) : undefined;
          const code = status === 401 ? 'INVALID_CREDENTIALS' : status === 402 || status === 403 ? 'INSUFFICIENT_BALANCE' :
            status === 423 ? 'UNSUPPORTED_MODEL' : status === 404 ? (method === 'GET' ? 'NOT_FOUND' : 'UNSUPPORTED_MODEL') :
            status === 400 || status === 422 ? 'INVALID_INPUT' : status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_UNAVAILABLE';
          throw new HiggsfieldError(code, seconds !== undefined && Number.isFinite(seconds) ? seconds : undefined);
        }
        // Bound body size; generation endpoints return metadata/URLs, never media bytes.
        const reader = response.body?.getReader();
        if (!reader) throw new HiggsfieldError('INVALID_RESPONSE');
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1_048_576) { await reader.cancel(); throw new HiggsfieldError('INVALID_RESPONSE'); }
          chunks.push(value);
        }
        let json: unknown;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HiggsfieldError('INVALID_RESPONSE'); }
        const parsed = schema.safeParse(this.redact(json));
        if (!parsed.success) throw new HiggsfieldError('INVALID_RESPONSE');
        return parsed.data;
      } catch (cause) {
        const error = signal.aborted ? new HiggsfieldError('TIMEOUT') : cause instanceof HiggsfieldError ? cause : new HiggsfieldError('UPSTREAM_UNAVAILABLE');
        this.options.logger?.warn({ event: 'higgsfield_request_failed', method, attempt, correlationId, code: safeError(error).code });
        const retryable = error.code === 'UPSTREAM_UNAVAILABLE' || error.code === 'RATE_LIMITED';
        if (attempt >= retries || !retryable || signal.aborted) throw error;
        const delay = error.retryAfterSeconds === undefined ? 500 * 2 ** attempt + Math.random() * 250 : error.retryAfterSeconds * 1000;
        // Long server-directed waits are returned to callers rather than holding connections.
        if (delay > 5000) throw error;
        try { await sleep(delay, undefined, { signal }); } catch { throw new HiggsfieldError('TIMEOUT'); }
      }
    }
  }
}
