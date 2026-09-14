# Testing and evidence

## Three different levels of evidence

`node scripts/run-core-tests.mjs` needs only Node 22.16+ and executes the portable TypeScript core through Node's type stripping. It includes synthetic Jules HTTP responses, local credentials, owner-login/browser state, mocked provider helpers, admin boundaries and private-file scripts. The resulting TAP and JSON reports give the exact Git SHA, runtime and counts. The current portable suite passes 192 tests. No model or live Google call is used.

`pnpm test:workers` is a separate suite using the current `@cloudflare/vitest-plugin` and real stateless SDK/OAuth-provider imports inside the Workers runtime. Its intended tests cover authenticated Streamable HTTP initialization, tool discovery, distinct identities, host/Origin/body guards, Stage-0 diagnostic tools, actual provider code exchange, downscoped refresh and grant revocation. Outbound HTTP is replaced with strict synthetic fetch responses; any unmatched request fails. The current Cloudflare test plugin no longer supplies the old `fetchMock` helper. This suite now executes successfully in Workerd with the actual installed provider and SDKs. It also exercises the official TypeScript MCP clients through a local fetch adapter, including benign writes, reconnection and denial after revocation. This is not an Internet deployment or a coding-product test. Sequential local KV revocation behaviour is not a global propagation guarantee.

Live acceptance uses a deployed isolated feasibility Worker with no Jules key, followed only later by production read-only tests and explicitly authorised disposable-repository mutations. Use `docs/client-trial-template.json`. Record exact client/surface/version, auth method, commit, deployment version, scope, operation and observed failure. No local suite or SDK client smoke test substitutes for the actual ChatGPT/Grokbot consumer.

## Commands

```sh
# Offline, without installed dependencies
node scripts/run-core-tests.mjs
node scripts/lint.mjs
node --experimental-strip-types scripts/check-schema.mjs
node scripts/scan-public.mjs
node --experimental-strip-types scripts/benchmark-core.mjs

# In a normal network-enabled environment: first-time dependency gate
npm install --global pnpm@10.13.1
pnpm install --frozen-lockfile
pnpm check
pnpm audit --prod --audit-level=high
```

The bootstrap refuses to claim success when a subprocess cannot launch. `pnpm check` includes formatting, policy lint, full type checking, core tests, schema comparison, Workers tests, credential-pattern scan and dry runs of both production and diagnostic entrypoints. It must pass before deployment.

## Fixtures, logs and reports

Fixtures use synthetic organisations, sessions, prompts and credentials. Credential-script tests generate actual random test-only values in temporary directories, verify hash/file-mode/non-printing behaviour, then delete them. Worker tests deny unmatched outbound fetch requests. Do not substitute live keys into tests or run production mutations as a convenient smoke test.

The offline scanner covers selected credential signatures only. It does not replace GitHub secret scanning/push protection, dependency advisories, code review or a dedicated scanner. The repository does not claim that a pattern scan proves all data is public-safe. Third-party runtime logs still need review during Stage 0; persistent automatic invocation logging is disabled by default to avoid retaining OAuth callback URLs.

Local wall-clock benchmarks isolate only the code they name. Use Cloudflare's actual CPU metric for the Free limit, including cold and warm OAuth/provider/SDK work and representative bounded artifacts. Do not extrapolate the Node microbenchmark into a Free-tier acceptance statement. Rollback, global revocation propagation, quota limits and every actual client remain separate acceptance tests.
