# higgsfield-mcp

Node.js + TypeScript MCP server connecting ChatGPT to the Higgsfield image/video API. Uses the **official MCP TypeScript SDK v2** (`@modelcontextprotocol/server` and `@modelcontextprotocol/node`), Zod, and Streamable HTTP at `/mcp`. Supports the current 2026 protocol and stateless legacy initialization on the same endpoint.

## Install and configure

Install Node.js **24 LTS** and npm, then open a terminal in this directory:

```sh
npm ci
```

Create `.env` from `.env.example` (PowerShell):

```powershell
Copy-Item .env.example .env
notepad .env
```

On macOS/Linux use `cp .env.example .env`. Fill in your own credentials from the [Higgsfield API console](https://open.higgsfield.ai):

```dotenv
HF_CREDENTIALS="YOUR_KEY_ID:YOUR_KEY_SECRET"
PORT=3000
```

Authentication re-checked **September 29, 2026**: the [authentication page](https://docs.higgsfield.ai/docs/authentication) still specifies `Authorization: Key KEY_ID:KEY_SECRET`. The [official TypeScript SDK setup](https://docs.higgsfield.ai/docs/how-to/sdk) stores that complete value in **one variable, `HF_CREDENTIALS`**. This project now uses that documented name and format instead of separate environment variables. The HTTP authentication scheme has not changed.

If the dashboard's single copied value already contains `ID:SECRET`, paste the entire value between the quotes. Do not split it, append another secret, or include `Key ` / `Bearer `. If the copied value has **no colon**, the inspected official docs do not establish how to use that value with these endpoints. Do not invent a second component or assume bearer authentication; check the dashboard's API example or obtain clarification from Higgsfield. Never send your actual key in chat. Replace the previous split credential variables in existing deployments and restart the server.

Credentials remain on the server. Never paste them into ChatGPT, a tool call, Git, or a URL. `.env` is excluded from Git and Docker. API billing is separate from a Higgsfield website subscription. No OpenAI API key is needed by this server.

## Run locally

```sh
npm run dev
```

Or run compiled JavaScript:

```sh
npm run build
npm start
```

Local mode binds to `127.0.0.1`. It allows health checks and model/tool discovery without credentials; API operations return a clear configuration error until keys are provided. The local health endpoint is `http://127.0.0.1:3000/health`; the MCP endpoint is `http://127.0.0.1:3000/mcp`.

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
npm run check:mcp
npm run check:connection
```

`check:mcp` connects using the official SDK, discovers all six tools, and calls `hf_list_models`. `check:connection` makes an authenticated **cost estimate** request; it does not submit a paid generation. It verifies access to the configured image adapter, not entitlement to every model. Health only reports process health and whether credentials are configured; it does not validate them upstream.

## Tools

| Tool | Behavior |
|---|---|
| `hf_list_models` | Supported model IDs, documentation links and parameter schemas; optional `kind` filter |
| `hf_estimate_cost` | Live account-specific `credits` and `usd` estimate; accepts `model` and `input` |
| `hf_generate_video` | Submit video generation and return `request_id` immediately |
| `hf_generate_image` | Submit image generation and return `request_id` immediately |
| `hf_get_generation_status` | Check an existing `request_id` once |
| `hf_get_generation_result` | Return completed media URLs or pending status; optional `wait_seconds` from 0 to 25 |

This release includes two verified adapters:

| Kind | Model ID |
|---|---|
| Video | `bytedance/seedance-2.0/text-to-video` |
| Image | `higgsfield-ai/soul/v2/standard` |

`hf_list_models` is explicitly a **supported catalog shipped with this project**, not the full live Higgsfield catalog. No public model-list REST endpoint was established in the inspected documentation. Adding a model requires a verified model-specific Zod adapter in `src/higgsfield/models.ts`; arbitrary model paths and parameters are rejected. Prices are never hard-coded.

Example `hf_estimate_cost` arguments:

```json
{
  "model": "higgsfield-ai/soul/v2/standard",
  "input": { "prompt": "An editorial portrait in soft daylight", "batch_size": 1 }
}
```

Example `hf_generate_video` arguments:

```json
{
  "model": "bytedance/seedance-2.0/text-to-video",
  "input": {
    "prompt": "A cinematic tracking shot along a sunlit coastal road",
    "duration": 5,
    "resolution": "720p",
    "aspect_ratio": "16:9",
    "generate_audio": true
  }
}
```

Generation tools return a structured envelope such as:

```json
{
  "ok": true,
  "data": {
    "request_id": "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff",
    "status": "queued",
    "status_url": "https://api.higgsfield.ai/requests/d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff/status"
  }
}
```

Pass that `request_id` and, when available, `status_url` to the status/result tool. Status URLs are validated against the official origin and the exact request path. ID-only calls use the documented status route, so jobs remain accessible after server restarts. The client stores no in-memory ownership/session database. All allowed OAuth subjects are trusted members of **one shared Higgsfield account** and can access that account's jobs. Deploy separate instances/keys for independent users; this is not a multi-tenant service.

The result tool checks once by default (`wait_seconds: 0`), returning `ready: false` if work is pending. Optional polling starts at two seconds, backs off with jitter, and ends within 25 seconds. A timeout leaves the upstream generation running. Save the ID and check later. Completed results use `images[].url` or `video.url` from the same status endpoint; there is no invented `/result` route. Preserve media in your own storage if needed beyond Higgsfield's retention period.

## Expose/deploy and connect ChatGPT

Follow [DEPLOYMENT.md](DEPLOYMENT.md) to configure OAuth and deploy behind HTTPS, or [SETUP_WINDOWS.md](SETUP_WINDOWS.md) for Windows instructions. A `Dockerfile` is included. Public production mode requires OAuth and configured Higgsfield credentials. For an explicitly requested temporary development tunnel, follow the ngrok section below.

Current [OpenAI connection instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt) (checked September 28, 2026):

1. Deploy a reachable HTTPS endpoint, for example `https://your-domain.example/mcp`, with the OAuth setup in the deployment guide.
2. In ChatGPT, open **Settings → Security and login → Developer mode**. Availability depends on account and workspace policy.
3. Open [ChatGPT Plugins](https://chatgpt.com/plugins), select **+**, enter a name/description and the full MCP URL under **Connection**. Older account interfaces may label this Apps/custom connectors.
4. Complete the OAuth account-linking flow and review the six discovered tools. Your authorization server must support the OpenAI client registration/linking requirements documented in the deployment guide.
5. Add the connection from a conversation's tools menu. Ask it to list models, estimate a cost, then generate only when you intend to spend the API balance.
6. After changing tools or metadata, restart/deploy and **Refresh** the connection.

ChatGPT cannot reach another machine's `localhost`. OpenAI also documents Secure MCP Tunnel for private developer-mode connections. Keep local anonymous mode private except for an explicitly authorized temporary development tunnel as described below. This project implements the OAuth resource server; identity-provider setup and HTTPS hosting require your accounts. ChatGPT does not accept your Higgsfield key as MCP authentication.

## Tests and scripts

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Tests mock Higgsfield HTTP responses; they never spend real credits. They cover payloads/authentication, async submission, status/results, validation, errors, timeouts, retry policy, redaction, tool discovery/calls, modern and legacy HTTP transport, OAuth/JWT checks, and request guards. CI runs on Windows and Linux. `npm run check:connection` is the separate opt-in live credential check. `MCP_URL` and `MCP_ACCESS_TOKEN` can be supplied through the environment for a remote `check:mcp` run.

## Setup on another PC

The repository is private. The other person needs GitHub access to it and Git installed; the owner must grant access through GitHub before cloning. Each person uses their own Higgsfield and ngrok credentials.

1. Clone the repository and enter its directory:
   ```sh
   git clone https://github.com/Saif9398/higgsfield-mcp.git
   cd higgsfield-mcp
   ```
2. Install **Node.js 24 LTS** (including npm) from [nodejs.org](https://nodejs.org/), then reopen your terminal.
3. Run `npm install`.
4. Copy `.env.example` to `.env`: `Copy-Item .env.example .env` in PowerShell, or `cp .env.example .env` on macOS/Linux. Do not overwrite an existing configured file.
5. Open `.env` locally and add your own full `HF_CREDENTIALS` value. Do not paste it into chat. All template values are blank; leaving the other entries blank selects port 3000, loopback host, local auth and info logging.
6. Run `npm run build`.
7. Run `npm test`. Also run `npm run typecheck` and `npm run lint` to verify the installation.
8. Run `npm run dev` and leave that terminal open.
9. In a second terminal in the repository directory, run `npm run check:connection`. This requests a cost estimate without submitting a paid generation.
10. Run `npm run check:mcp` to verify local MCP discovery and all six tools.

Never copy another person's `.env`, ngrok configuration, logs, caches, dependencies or build output. See [SETUP_WINDOWS.md](SETUP_WINDOWS.md) for Windows details and [DEPLOYMENT.md](DEPLOYMENT.md) for production OAuth/HTTPS setup.

### Configure ngrok and obtain this PC's public MCP URL

For an explicitly requested temporary development tunnel:

1. Install the [official ngrok agent](https://ngrok.com/download/windows) on the new PC. The binary and existing local ngrok configuration are intentionally excluded from this repository. On Windows the documented installer is `winget install ngrok -s msstore`; reopen the terminal afterward.
2. Sign into that person's own [ngrok dashboard](https://dashboard.ngrok.com) to obtain their authtoken. In PowerShell, run the included hidden-input setup script:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-ngrok.ps1
   ```
   Paste the token only at its local hidden prompt. The script runs ngrok's authtoken configuration command, suppresses its raw output, and saves the token in ngrok's local user configuration. If ngrok is not on PATH, pass `-NgrokPath 'C:\path\to\ngrok.exe'`. On another OS, use ngrok's documented local configuration flow; never send the token to a chat or commit its configuration.
3. Keep the MCP server running on port 3000. In another terminal, start the temporary tunnel:
   ```sh
   ngrok http http://127.0.0.1:3000 --traffic-policy-file scripts/ngrok-traffic-policy.json --inspect=false --log=false
   ```
   The tracked traffic policy contains no credentials. It rewrites the upstream Host header for the local server. Request inspection is disabled.
4. Use the HTTPS origin displayed by **this new ngrok session**; do not reuse a URL from another person's PC. The assigned hostname depends on the ngrok account and may be reused across sessions. Append `/mcp` to that origin for the ChatGPT connection.
5. Verify the public URL in PowerShell, replacing the example origin with the one ngrok actually displayed:
   ```powershell
   $publicOrigin = 'https://YOUR-NGROK-HOST'
   Invoke-RestMethod ($publicOrigin + '/health') -UserAgent 'higgsfield-mcp-health-check'
   $env:MCP_URL = $publicOrigin + '/mcp'
   npm run check:mcp
   Remove-Item Env:MCP_URL
   ```
6. Add that exact HTTPS `/mcp` URL to ChatGPT. Leave both server and tunnel terminals open. Press Ctrl+C in the ngrok terminal when finished; this does not stop the local MCP server.

HTTPS encrypts the tunnel but local auth mode does not authenticate remote callers. Anyone with this temporary URL can invoke the tools and spend the connected account's balance. Share it only for the intended development session and close it afterward. Permanent/public deployments require the OAuth setup in [DEPLOYMENT.md](DEPLOYMENT.md).

## Architecture and safeguards

- `src/higgsfield/`: reusable HTTP client, model schemas, payload types and error mapping; no MCP dependencies.
- `src/mcp/tools.ts`: six validated tools, structured responses and safety annotations.
- `src/app.ts`, `src/auth.ts`, `src/config.ts`: HTTP transport, OAuth JWT verification, fail-closed configuration and health check.
- `src/logger.ts`: structured logging with secret-value and sensitive-field redaction. Prompts, authorization headers, full errors and raw provider responses are not logged.
- `scripts/`: non-generating connection and MCP discovery checks; `tests/`: unit and protocol/integration tests.

HTTP requests have a 15-second total budget including read retries. Only GET status requests retry transient errors, at most twice; `Retry-After` is honored, and waits over five seconds are returned to the caller. Generation and estimate POSTs never auto-retry. Higgsfield does not document idempotency keys for submission: after a network failure or timeout, check the console before resubmitting. Error codes distinguish credentials, balance, unsupported models, input/prompt, failure/moderation/cancellation, timeout, not-found, rate limits, and unexpected responses. Provider `400/422` cannot reliably distinguish prompt rejection from other validation and map to `INVALID_INPUT`; local prompt validation is explicit.

## Verified documentation

Implementation sources reviewed September 28, 2026:

- [Higgsfield documentation index](https://docs.higgsfield.ai/docs/llms.txt), [authentication](https://docs.higgsfield.ai/docs/authentication), [request lifecycle](https://docs.higgsfield.ai/docs/concepts/requests), [status schema](https://docs.higgsfield.ai/docs/api-reference/requests/get-request-status).
- [Polling](https://docs.higgsfield.ai/docs/concepts/polling), [errors/retries](https://docs.higgsfield.ai/docs/concepts/errors), [estimates and retention](https://docs.higgsfield.ai/docs/concepts/billing-and-retention).
- [Seedance 2.0 schema](https://open.higgsfield.ai/models/bytedance/seedance-2.0/text-to-video/api-reference), [Soul 2 schema](https://open.higgsfield.ai/models/higgsfield-ai/soul/v2/standard/api-reference).
- [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [OpenAI MCP requirements](https://developers.openai.com/plugins/build/mcp-server), [OpenAI OAuth requirements](https://developers.openai.com/plugins/build/auth).

The SDK's upstream v2 packages are the current stable release; OpenAI's setup page still shows the maintained v1 package name. This project uses v2 with its official legacy compatibility path. Documentation-confirmed model availability is not proof of access by your account; use the live estimate check after supplying keys.
