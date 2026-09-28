import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createApp } from '../src/app.js';
import { createTokenVerifier } from '../src/auth.js';
import { loadConfig, type Config } from '../src/config.js';
import { HiggsfieldClient } from '../src/higgsfield/client.js';
import { createLogger } from '../src/logger.js';

const oauthEnv = {
  AUTH_MODE: 'oauth', PUBLIC_URL: 'https://mcp.example.com', OAUTH_ISSUER: 'https://issuer.example.com/',
  OAUTH_JWKS_URL: 'https://issuer.example.com/jwks', OAUTH_ALLOWED_SUBJECTS: 'owner',
  HF_CREDENTIALS: 'test-id:test-secret',
};
let http: Server | undefined;
let runtime: ReturnType<typeof createApp> | undefined;
async function start(config: Config = loadConfig({}), verify?: ReturnType<typeof createTokenVerifier>) {
  const hf = new HiggsfieldClient({ credentials: '', fetch: vi.fn() });
  runtime = createApp(config, hf, createLogger([], 'silent'), verify);
  http = createServer(runtime.app);
  await new Promise<void>(resolve => http!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await runtime?.close();
  if (http) { http.closeAllConnections(); await new Promise<void>(resolve => http!.close(() => resolve())); }
  http = undefined; runtime = undefined;
});

describe('HTTP transport and security', () => {
  it('serves a healthy endpoint and all tools over a real HTTP connection', async () => {
    const base = await start();
    expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ status: 'ok', credentials_configured: false });
    const client = new Client({ name: 'http-test', version: '1' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      expect((await client.listTools()).tools).toHaveLength(6);
      expect((await client.callTool({ name: 'hf_list_models', arguments: {} })).isError).not.toBe(true);
    } finally { await client.close(); }
  });
  it('supports legacy MCP initialization and discovery on the same endpoint', async () => {
    const base = await start();
    const post = (body: object) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26' }, body: JSON.stringify(body) });
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'legacy-test', version: '1' } } });
    expect(init.status).toBe(200); expect(await init.text()).toContain('higgsfield-mcp');
    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(list.status).toBe(200); expect(await list.text()).toContain('hf_generate_video');
  });
  it('rejects DNS rebinding, untrusted origins and oversized bodies', async () => {
    const base = await start();
    const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${base}/mcp`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    expect(hostileHostStatus).toBe(403);
    expect((await fetch(`${base}/mcp`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(140_000) }) })).status).toBe(413);
  });
  it('publishes OAuth discovery and enforces tokens, allowed subjects and scopes', async () => {
    const verify = vi.fn<ReturnType<typeof createTokenVerifier>>();
    const base = await start(loadConfig(oauthEnv), verify);
    const metadata = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
    expect(metadata.resource).toBe('https://mcp.example.com/mcp');
    const missing = await fetch(`${base}/mcp`);
    expect(missing.status).toBe(401); expect(missing.headers.get('www-authenticate')).toContain('resource_metadata=');
    verify.mockRejectedValueOnce(new Error('secret')); expect((await fetch(`${base}/mcp`, { headers: { Authorization: 'Bearer fake' } })).status).toBe(401);
    verify.mockResolvedValueOnce({ sub: 'someone-else', scope: 'higgsfield:use' }); expect((await fetch(`${base}/mcp`, { headers: { Authorization: 'Bearer fake' } })).status).toBe(403);
    verify.mockResolvedValueOnce({ sub: 'owner', scope: '' }); expect((await fetch(`${base}/mcp`, { headers: { Authorization: 'Bearer fake' } })).status).toBe(403);
    verify.mockResolvedValue({ sub: 'owner', scope: 'higgsfield:use' });
    const client = new Client({ name: 'oauth-test', version: '1' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: 'Bearer fake' } } }));
      expect((await client.listTools()).tools).toHaveLength(6);
    } finally { await client.close(); }
  });
});

describe('JWT verification and configuration', () => {
  it('validates signatures, issuer, resource audience and expiry', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    const verify = createTokenVerifier(loadConfig(oauthEnv), createLocalJWKSet({ keys: [{ ...jwk, kid: 'test' }] }));
    const token = (aud = 'https://mcp.example.com/mcp', issuer = oauthEnv.OAUTH_ISSUER, exp: string | number = '5m') => new SignJWT({ scope: 'higgsfield:use' }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject('owner').setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(privateKey);
    expect((await verify(await token())).sub).toBe('owner');
    await expect(verify(await token('other-resource'))).rejects.toThrow();
    await expect(verify(await token(undefined, 'https://wrong.example.com'))).rejects.toThrow();
    await expect(verify(await token(undefined, undefined, Math.floor(Date.now() / 1000) - 60))).rejects.toThrow();
    const good = await token(); const parts = good.split('.');
    await expect(verify(`${parts[0]}.${parts[1]}.invalid-signature`)).rejects.toThrow();
  });
  it('fails closed for public local mode and incomplete production auth', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow();
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow();
    expect(() => loadConfig({ AUTH_MODE: 'oauth' })).toThrow();
    expect(() => loadConfig({ ...oauthEnv, PUBLIC_URL: 'http://mcp.example.com' })).toThrow();
    expect(() => loadConfig({ ...oauthEnv, HOST: '0.0.0.0', NODE_ENV: 'production' })).not.toThrow();
  });
});
