# Deployment

The service exposes `/mcp` using the official SDK's Streamable HTTP handler, with current protocol support and a stateless legacy fallback. `/health` reports process health. Generation finishes in Higgsfield; the web server does not hold an HTTP connection open for the entire job.

## Trust and account model

One deployment uses one server-owned Higgsfield account. Every allowed OAuth subject can spend its balance and inspect its jobs. Allow only the owner or trusted teammates. For another independent customer/person, deploy a separate instance with their credentials. This project does not implement per-tenant credentials, job ownership storage or a public multi-user SaaS.

Local mode is anonymous and loopback-only. Production mode refuses to start without OAuth settings and Higgsfield keys. Do not publish a proxy/tunnel to anonymous local mode. API credentials never travel to ChatGPT; OAuth authenticates the ChatGPT user to this server separately.

## OAuth identity-provider setup

This server is an **OAuth resource server**, not an authorization server. Use an existing OAuth 2.1-compatible provider. Configure it before public use; account creation, domain ownership and OAuth registration require your accounts.

1. Register the resource/audience `https://YOUR_HOST/mcp` and scope `higgsfield:use`. The audience must match the exact URL, including `/mcp` and no trailing slash. Do not substitute an ID token for an access token.
2. Enable authorization code flow with PKCE S256 and the provider's support for the MCP `resource` parameter. The authorization server must bind the token to this resource and preserve the resource through authorization/token requests.
3. Publish OAuth/OIDC authorization-server metadata, authorization/token endpoints and JWKS. The issuer value must exactly match the token's `iss` claim, including any trailing slash.
4. Support one OpenAI-supported client identification method: Client ID Metadata Documents (CIMD), dynamic client registration (DCR), or a pre-registered OAuth client. Use the **current official callback/client metadata** from [OpenAI's authentication guide](https://developers.openai.com/plugins/build/auth) and the linking interface. Do not allow wildcard redirect URIs. Publish supported token endpoint authentication methods. Configure consent for the requested scope.
5. Issue **signed JWT access tokens using RS256 or ES256** with `iss`, `aud`, `sub`, `iat`, `exp` and a space-delimited `scope` containing `higgsfield:use`. Opaque-token introspection is not implemented. Use short-lived access tokens; provider refresh/revocation policy governs ongoing access. This resource server checks signatures/expiry but does not make a per-request revocation/introspection call.
6. Set `OAUTH_ALLOWED_SUBJECTS` to the exact owner `sub` value; use comma-separated values only for equally trusted users sharing the same Higgsfield account. Enforce suitable access policy at the provider as well.

The app publishes `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`. Missing/invalid tokens receive HTTP 401 with a discovery `WWW-Authenticate` challenge; missing scope gets 403 with an insufficient-scope challenge. Wrong subject receives 403. All MCP routes, including discovery/tool listing, require authentication in OAuth mode; health and protected-resource metadata remain public.

Example environment configuration (substitute your actual domain/provider values, never commit secrets):

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
AUTH_MODE=oauth
HF_CREDENTIALS=
PUBLIC_URL=https://mcp.example.com
OAUTH_ISSUER=https://identity.example.com/
OAUTH_JWKS_URL=https://identity.example.com/.well-known/jwks.json
OAUTH_ALLOWED_SUBJECTS=owner-subject-from-your-provider
OAUTH_SCOPE=higgsfield:use
ALLOWED_ORIGINS=https://chatgpt.com
LOG_LEVEL=info
```

`PUBLIC_URL` is the origin only. Browser requests with an Origin header must match `ALLOWED_ORIGINS`; server-to-server requests without Origin are accepted after authentication. Add an exact Inspector origin only if needed. Host validation accepts the public hostname and loopback hostnames. Do not trust or log arbitrary forwarded authorization headers.

Set `HF_CREDENTIALS` to the full `KEY_ID:KEY_SECRET` value, without an authorization prefix. This is the single-variable format in the [official TypeScript SDK setup](https://docs.higgsfield.ai/docs/how-to/sdk), re-checked September 29, 2026. Replace previous split credential variables in your host's secret configuration. The upstream header remains `Authorization: Key ...`; these docs do not establish support for a standalone opaque key. MCP OAuth bearer tokens remain separate from the Higgsfield credential.

ChatGPT does not support a custom static API-key header as a replacement for its OAuth linking flow. A bearer access token in `check:mcp` is only a diagnostic client mechanism. See the [official OpenAI authentication requirements](https://developers.openai.com/plugins/build/auth).

## Build and run

Without Docker:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

For a container:

```sh
docker build -t higgsfield-mcp:1.0.0 .
docker run --rm --name higgsfield-mcp --env-file .env -p 127.0.0.1:3000:3000 higgsfield-mcp:1.0.0
```

Use an OAuth-configured `.env` for this command. The image defaults to `NODE_ENV=production`, `AUTH_MODE=oauth`, `HOST=0.0.0.0` and runs as a non-root user. The image excludes `.env`; production hosts should inject secrets from their secret manager. Preserve `HOST=0.0.0.0` **inside** the container so the published port works. The example published port stays loopback-only for a same-host TLS proxy.

The Dockerfile installs the lockfile, builds TypeScript in a separate stage and installs runtime dependencies in the final stage. Run the CI checks before deploying an image. Pin the Node base image by digest in your own release process for fully reproducible builds and update it for security patches.

## HTTPS and reverse proxy

Use a managed container host with HTTPS ingress or a TLS reverse proxy. Publish `/mcp`, `/health` and `/.well-known/oauth-protected-resource*`. Preserve the external Host header, Authorization, Accept, Content-Type, MCP protocol headers, and HTTP methods. Disable SSE response buffering and allow response streaming. Allow a request timeout of at least 40 seconds; the result tool polls for at most 25 seconds. Do not put an interactive HTML login page in front of `/mcp`; OAuth uses standard discovery and bearer challenges.

For an existing nginx TLS virtual host, the relevant proxy location can be:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 45s;
    client_max_body_size 128k;
}
```

TLS certificate and virtual-host configuration depend on your host and are not provisioned here. For Docker-to-Docker proxying use an isolated container network instead of the loopback example.

The application deliberately leaves Express `trust proxy` disabled and limits MCP traffic to 120 requests/minute per observed source IP per process. Behind a proxy, clients may share that bucket. Configure a real edge per-user/IP rate limit and generation budget controls for larger deployments; do not enable blanket `trust proxy=true` or trust client-supplied forwarded IPs. Limit concurrent requests and provider spending at your ingress/account as appropriate. Multiple replicas have independent in-memory rate limits; use a shared store or edge limits when scaling. No session affinity or shared job cache is required by the stateless MCP transport.

## Verify deployment

1. Check `https://YOUR_HOST/health` returns HTTP 200. No secrets should appear in the response/logs.
2. Fetch the protected-resource metadata; confirm the issuer and exact `/mcp` resource URL.
3. Verify unauthenticated `/mcp` returns 401 with the metadata challenge.
4. Obtain an access token through your provider's owner login flow. Set `MCP_URL` and `MCP_ACCESS_TOKEN` in a private environment, then run `npm run check:mcp`. This only lists tools and models. Do not place the token in shell history or a URL.
5. Run `npm run check:connection` with deployment-equivalent Higgsfield credentials. This estimates an image without generating one.
6. Add the HTTPS URL to ChatGPT using [README.md](README.md), complete OAuth, and confirm tool discovery.
7. When ready to spend funds, test one generation and retain its request ID. Check results separately.

OpenAI's [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) can connect private servers in developer mode. It requires separate tunnel/workspace setup. It does not replace the public HTTPS endpoint needed for public plugin submission. Temporary HTTPS tunnels still require the OAuth configuration above for this server.

## Operations

- Request logs contain tool name, result/error code, HTTP status and elapsed time. Provider failure logs include a redacted correlation ID when supplied. Retain the returned request ID securely for support; prompts and output URLs are not logged.
- Set alerts for repeated 401, balance failures, 429, upstream failures, and latency. Protect access to logs and deployment secrets.
- Generation POSTs have no automatic retry, and the current client does not send provider idempotency keys. Higgsfield now documents [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency), but this implementation does not yet use that feature. An ambiguous network failure requires checking the account console first.
- Keep the request ID externally if you need durable workflow history. Polling timeout/disconnect does not cancel a paid upstream generation.
- SIGTERM/SIGINT stop HTTP acceptance and close MCP handlers; shutdown has a ten-second force-close bound. The container has a health check.
- Rotate keys through environment/secrets configuration and restart. All keys and model adapters should be reviewed periodically against current official docs.
- Preserve generated files in your own storage when needed long-term. This server returns URLs and never downloads or proxies media.

Actual public hosting, TLS certificates, the OAuth provider, user linking and account-funded live generation must be verified in your deployment; unit tests cannot establish those external conditions.
