# Windows setup

## Prerequisites

Install Node.js 24 LTS from [nodejs.org](https://nodejs.org/), including npm. Restart PowerShell and verify:

```powershell
node --version
npm --version
```

If your execution policy blocks `npm.ps1`, use `npm.cmd` in the commands below. There is no need to disable Windows security or run the server as Administrator.

## Install this project

This repository is public and can be cloned by anyone with Git. Each installation needs its own Higgsfield credentials and local configuration. Open PowerShell and run:

```powershell
git clone https://github.com/Saif9398/higgsfield-mcp.git
Set-Location higgsfield-mcp
npm ci
Copy-Item .env.example .env
notepad .env
```

Only copy `.env.example` if `.env` does not already exist. Set `HF_CREDENTIALS="YOUR_KEY_ID:YOUR_KEY_SECRET"` using the complete combined credential. Do not include `Key ` or `Bearer `. The official docs still specify a colon-separated ID and secret; a single opaque value without a colon is not verified by those docs. Keep `HOST=127.0.0.1` and `AUTH_MODE=local` for private local work. Keep `.env` out of shared folders and version control.

## Validate and run

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run check:connection
npm start
```

Leave that terminal open. In a second terminal in the project directory:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
npm run check:mcp
```

The connection check requests a live image cost estimate; it does not generate media. Tests use mock provider responses and do not require keys. For development, use `npm run dev` instead of `npm start`. Press **Ctrl+C** to stop the server.

If port 3000 is already in use, set a free port in `.env`, restart, and adjust the health URL. Set the smoke-check URL separately:

```powershell
$env:MCP_URL = 'http://127.0.0.1:3001/mcp'
npm run check:mcp
```

## Connect ChatGPT

Your local URL is not directly accessible to hosted ChatGPT. Configure an OAuth identity provider and HTTPS deployment as described in [DEPLOYMENT.md](DEPLOYMENT.md), then add the remote `/mcp` URL using the ChatGPT steps in [README.md](README.md). OpenAI's Secure MCP Tunnel is another documented option for private developer-mode connections; its workspace setup is separate from this project.

Do not open a router port or publicly forward anonymous local mode. The default production Docker image requires OAuth. On Windows, Docker Desktop must be running in Linux containers mode to build it.

## Move to another PC

Copy source, manifests/lockfile, tests, docs and `.env.example`. Exclude `.env`, logs, `node_modules`, `.npm-cache` and `dist`. The new owner installs Node.js, runs `npm ci`, creates their own `.env` and runs the same checks. Higgsfield credentials and OAuth owner configuration belong to that person; nothing in the source needs to be rewritten.

## Troubleshooting

| Symptom | Action |
|---|---|
| `INVALID_CREDENTIALS` | Check the full `HF_CREDENTIALS` value is `KEY_ID:KEY_SECRET` and restart after editing `.env` |
| `INSUFFICIENT_BALANCE` | Fund the Higgsfield API account; website subscription credits are separate |
| `UNSUPPORTED_MODEL` | Use a listed adapter and verify account/model access in the console |
| `TIMEOUT` after submission | Check the console first; the job may already exist and may cost money if repeated |
| Health succeeds, generation fails | Health does not test credentials; use `check:connection` |
| Vitest worker `spawn EPERM` | Run tests in a normal trusted terminal outside the restricted agent sandbox; don't disable antivirus globally |
| ChatGPT cannot connect | Verify public HTTPS, exact `/mcp` URL, OAuth discovery, allowed subject and token audience/scope |

Structured logs go to stdout. Do not send your `.env` or raw authorization headers when requesting support.
