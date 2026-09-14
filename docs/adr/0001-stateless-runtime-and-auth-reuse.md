# ADR 0001: Stateless remote Worker with maintained OAuth and portable Jules core

Status: accepted for the prototype; deployment qualification remains open.

Use TypeScript, the current official MCP v2 server and Cloudflare's stateless factory. Create a request-local server and verified principal; no shared mutable auth state, Durable Object, task database or scheduler. Keep the experimental API origin, version and wire parsing behind a portable HTTP client.

Use Cloudflare's maintained OAuth provider instead of implementing a token server. Minimal owner-only GitHub identity glue provides login and one-time connection consent. Pre-register client redirect URIs through provider helpers; do not enable public registration or fetch client-supplied metadata URLs. Individually generated machine credentials resolve to the same two-scope principal. The separate administrative credential cannot invoke or be invoked through ordinary Jules tools.

The existing Google Labs MCP package is useful prior art but its local process/cache architecture is not the desired Worker deployment. No code was copied from it and no extra cache/runtime database was added. Original code is MIT; dependent packages retain their own licences.

Consequences: one small auth KV namespace is required; revocation is eventually consistent, and login transactions are not a globally atomic replay store. Upstream single-use code exchange is still required. A single request has a deadline, bounded calls and bounded output; no hidden supervisor or persistent subscriptions are promised. Current Free CPU and rate-limit eligibility need measured deployment evidence before release.

See `../sources.md` and `../threat-model.md` for provenance and residual risks.
