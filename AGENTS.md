# Contributor/agent contract

The project is an independent public, generic remote Jules MCP gateway. Preserve these boundaries.

## Exact commands

- Offline core tests: `node scripts/run-core-tests.mjs`.
- Offline architecture/security policy lint: `node scripts/lint.mjs`.
- Offline secret-pattern check: `node scripts/scan-public.mjs`.
- Tool-schema contract check: `node --experimental-strip-types scripts/check-schema.mjs`.
- Core type checking after dependencies: `pnpm typecheck:core`.
- Historical one-time dependency resolution: `pnpm bootstrap` (network required; review/commit resulting lockfile and formatting changes).
- Reproducible install: `pnpm install --frozen-lockfile`.
- Full gate: `pnpm check` (format, policy lint, full typecheck, offline tests, schema, Worker-runtime tests, secret scan, both dry runs).
- Schema update only after intentional review: `pnpm schema:update`; refresh client tool definitions.
- Generate explicit private config: `pnpm deploy:config`.

Never claim a command passed without running it. Node tests are not Workerd tests. A Wrangler dry run is not a deployment. A deployed endpoint is not a verified ChatGPT/Grokbot connection. Update docs/implementation-status.md with actual evidence.

## Non-negotiable boundaries

1. Public code contains no credentials, real private repository names, personal deployment IDs, domains, user prompts or infrastructure configuration. `.private/`, `.deploy/`, `.dev.vars*` and reports are excluded from Git.
2. Target Workers Free. No paid upgrade, Durable Object, task database, queues, scheduler, VPS, Docker, Redis, Supabase or tailnet requirement. Auth KV only. Do not silently remove a limiter if account eligibility fails; stop the release gate and investigate a Free-compatible alternative.
3. Jules origin/version knowledge belongs only in `src/jules/client.ts`; its layer must remain platform independent.
4. Never automatically retry a mutation. Lost/malformed/oversized responses after dispatch must not launch a second task. Correlation IDs are not idempotency keys. Exact-once is not promised.
5. All connected sources are eligible. No second allowlist. Exact owner/repo addressing, complete bounded scans, actual reported default branch and preserved explicit branch case. Incomplete scans must be explicit.
6. Trusted client control is direct. No gateway per-action approval queue; no mislabelled read-only writes. Session deletion is not asserted to be cancellation. No direct GitHub merge or credential-admin MCP tool.
7. Authenticated principals are request-local. Never infer them from a client name, User-Agent or arbitrary headers. No prompt/code/token/raw upstream error logging.
8. Secrets and personal login/consent belong in provider interfaces. Do not request tokens pasted into chat, issue text, source code or command arguments.
9. Tests use synthetic responses. Live mutation is opt-in only in an explicitly designated disposable repository. Never test against a production task or merge a PR.
10. Use standard GitHub-hosted Linux runners. No self-hosted runner, pull_request_target, production secrets in PR checks or autonomous merge. Production deployment uses trusted main and the protected environment after validation.
11. `src/feasibility.ts` is an isolated diagnostic deployment. It must never be imported into `src/index.ts` or advertised as production.

The dependency blocker is resolved: use pnpm 10.13.1 and frozen installs. History scanning requires a full clone. Keep Wrangler JSONC files strict-JSON-compatible for the dependency-free renderer. See docs/implementation-status.md for live gates; local Workerd tests are not hosted-client verification.
