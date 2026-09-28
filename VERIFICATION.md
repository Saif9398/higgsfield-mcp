# Verification — September 28, 2026

## Private repository preparation — September 29, 2026

- Added the ten-step **Setup on another PC** guide, private clone URL, and instructions for obtaining that PC's own temporary ngrok URL.
- Added a reusable hidden-input ngrok configuration script and a credential-free traffic policy. Existing machine-specific ngrok files remain excluded.
- `.env.example` contains only blank values. Empty non-secret entries now select the documented local defaults; the actual local `.env` is excluded and unchanged.
- TypeScript checks, lint and build passed. **58 tests passed** across four suites.
- Audited publishable files against the actual local credential values in memory, without printing those values. No matches were found.
- Gitleaks v8.30.1 was downloaded from its official release and checked against its published SHA-256 checksum. The publication snapshot scan reported no leaks, with full finding redaction enabled.
- Git ignore checks cover `.env`, ngrok configuration/state, local tooling, logs, caches, dependencies and compiled output. Only project source, tests, scripts, documentation, package/build files and CI configuration are intended for the initial commit.
- No credentials, current tunnel URL, machine-specific ngrok configuration, or downloaded binaries are included in the publication snapshot.

## Authentication update — September 29, 2026

- Re-fetched official [authentication](https://docs.higgsfield.ai/docs/authentication) and [SDK setup](https://docs.higgsfield.ai/docs/how-to/sdk) documentation. Both still use `Authorization: Key KEY_ID:KEY_SECRET`; the TypeScript SDK documents a single `HF_CREDENTIALS` variable holding the combined value. A switch to standalone opaque keys was not established.
- Updated client/configuration, health checks, scripts, tests, `.env.example`, the existing blank `.env`, and setup/deployment docs to use `HF_CREDENTIALS`. No credentials were provided or exposed.
- Added format validation and redaction for the full value and its individual components. Unsupported formats fail before HTTP instead of guessing an authorization scheme.
- `npm run typecheck`, `npm run lint`, and `npm run build`: passed.
- `npm test`: **57 tests passed** across four suites, including HTTP MCP discovery and OAuth checks.
- Live Higgsfield authentication remains unverified without a real credential. Set `HF_CREDENTIALS="YOUR_KEY_ID:YOUR_KEY_SECRET"`, restart, and run `npm run check:connection` for the non-generating estimate check.

## Initial project verification

Completed on Windows with Node.js 24.19.0:

- Installed pinned runtime and development dependencies; generated `package-lock.json`. npm reported zero vulnerabilities during installation.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm test`: **46 tests passed** across three suites.
- Started the compiled server on `127.0.0.1:3000`.
- `GET /health`: HTTP 200, `status: ok`, `credentials_configured: false`.
- `npm run check:mcp`: connected to the running server, discovered all six required tools, and successfully called `hf_list_models`.
- `npm run check:connection`: safely returned `INVALID_CREDENTIALS` because no Higgsfield keys were supplied. No paid generation was submitted.

Runtime and test dependencies are pinned in the lockfile. TypeScript 6.0.3 was selected because the current TypeScript ESLint parser does not support TypeScript 7. The official MCP SDK v2.1.0 supports current and legacy clients; both protocol paths were exercised in HTTP tests.

Remaining external verification:

1. Enter your keys in the created, ignored `.env`, restart the server and run `npm run check:connection`.
2. Configure an OAuth provider and HTTPS host using `DEPLOYMENT.md`; verify a real ChatGPT account-linking flow.
3. Submit a paid generation only when you intend to spend your account balance, then retrieve its output.
4. Start Docker Desktop's Linux engine before testing `docker build`. The Docker CLI is installed here, but its engine was unavailable. The image has not been built or run in this session.

Tests mock upstream Higgsfield behavior. OAuth signature/claims tests use locally generated test keys; they do not validate a real identity provider. CI configuration was created but has not run on a hosted CI service. The workspace was not an existing Git repository, and no repository was published or remote infrastructure provisioned.
