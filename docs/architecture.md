# Architecture

## Boundaries

Each deployment belongs to one Jules account. `src/jules/` contains the portable HTTP client, types, resource validators and deterministic repository resolver. Only `client.ts` knows Google’s origin and experimental API version. It accepts an injected fetch implementation and a request-local budget. There is no repository database or persistent source cache.

`src/mcp/catalog.ts` is the tool/schema catalogue. `execute.ts` validates arguments, checks verified scopes, applies a separate read/control limiter, calls the Jules client and produces bounded structured results plus short text. `server.ts` adapts these definitions to the official MCP SDK. A fresh factory closes over each request’s principal; no module-global mutable principal or MCP server is reused across callers. The current Cloudflare `agents/mcp/server` stateless factory provides negotiation and compatibility with older Streamable HTTP protocol clients. No deprecated McpAgent or Durable Object is used.

`src/platform/worker.ts` owns the canonical origin check, exact browser Origin policy, body limits, pre-auth limiter, shared deadline, bounded response handling and generic errors. The provider protects `/mcp`; the handler also checks the exact path. SDK responses may be JSON or finite SSE and retain their original content type. A response is buffered within a bounded ceiling so the request budget cannot be closed while its tool work is still streaming. Long-lived event subscriptions are not supported.

## Authentication

Cloudflare’s maintained OAuth provider handles discovery, authorization codes, token exchange, PKCE protocol checks, resource/audience binding, refresh and grant/token persistence. Its integration is configured explicitly: canonical `/mcp` resource, S256 only, 15-minute access tokens, 30-day refresh grants, no implicit flow, no OAuth token exchange grant, no open DCR and no CIMD fetches.

The provider’s external-token callback validates a separate `jmg_ID.RANDOM` machine-token namespace. OAuth and service credentials resolve to the same verified principal. All initial machine credentials default to both scopes; `--read-only` is optional. Caller-supplied names, headers and User-Agent strings cannot establish identity. Credentials share Jules authority rather than isolating tenants or repositories.

The owner-login adapter uses a small escaped connection-consent page, browser cookie binding, expiring KV transactions and GitHub S256 login. It checks the stable numeric owner ID; the GitHub access token is used only to retrieve that identity and is not retained. The final MCP authorization code/token handling stays with the maintained provider.

A separate high-entropy owner administration credential authenticates `/admin`, which is not an MCP tool. Browser-originated admin requests are rejected. The script supports client creation, grant listing/revocation and client deletion through provider helpers, never opaque KV record edits. Runtime Jules credentials cannot administer the gateway.

## State

Production KV contains OAuth provider clients/grants/token records and short-lived owner-login state. No Jules task content, sessions, repository snapshots or operational audit rows are stored. The isolated Stage-0 Worker also writes a random nonce for 120 seconds to test truthful write-tool compatibility. Its entrypoint and deployment must remain separate from production.

KV is eventually consistent. Provider security checks and short TTLs do not turn get/delete into a globally atomic transaction. Upstream GitHub codes are single-use; sequential callback replay is tested. Global revocation timing and edge cases still require deployed qualification.

## Request policy

Defaults: 20 seconds, at most 20 counted external operations (KV, limit calls, GitHub identity HTTP and Jules HTTP), 64 KiB inbound body, 256 KiB upstream body, 60,000 structured-result characters, 512 KiB transport response, one 20-item list page, eight 100-source resolver pages and 20,000 patch characters. `LIMITS_JSON` can lower these ceilings, not silently enlarge them.

Read failures may receive at most two retries with jitter and bounded Retry-After. Mutations are dispatched once. Ambiguous outcomes are reported explicitly; known 4xx errors remain classified. A valid but oversized successful session response returns the session identifier and “succeeded/output omitted,” rather than falsely prompting a second create. Request IDs are correlation only, never idempotency keys.

## Free-tier release gate

No configuration requests paid products or upgrades. The reference uses a Worker, auth KV and native approximate rate-limit bindings. Cloudflare CPU/memory/quota eligibility must be measured on the actual Free account; local wall time is not CPU qualification. SDK and OAuth dependencies may make the 10 ms CPU ceiling a practical risk. If Stage 0 cannot fit, optimise the adapter or report infeasibility under Free—do not upgrade silently.

## Deliberate exclusions

No queue, scheduler, task DB, dashboard, local stdio adapter, VPS/tunnel/tailnet integration, multitenant service, direct GitHub merge, shell, notifications, implicit background orchestration or extra REST surface. Jules can continue a task upstream after a call, but that does not keep ChatGPT running.

## Source identifiers

Exact opaque source IDs and full `sources/ID` names are accepted. Google's current reference shows flat IDs, while its quickstart also shows `github/owner/repo` IDs; both are supported without URL forwarding or path traversal. A bare value is interpreted only as an exact source ID, never as a fuzzy repository search. `owner/repo` resolution still scans structured metadata with bounded pagination and rejects ambiguity.
