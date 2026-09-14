# Security policy

This is a pre-release prototype. It has not completed a live deployment security review or hosted-client qualification. Do not expose a production Jules key until the dependency/bootstrap, Worker-runtime, OAuth and Free-tier feasibility gates pass.

Report a suspected vulnerability through the repository’s private GitHub security advisory channel when enabled. Do not post credentials, real prompts, code, private repository names, OAuth authorization codes or raw provider logs in public issues. Supply a synthetic reproduction and affected commit instead. No response-time guarantee is made.

The deployment serves one Jules account. A control client may create tasks and PRs, send instructions, approve plans and delete sessions. A client can inspect tasks created by another client. Separate credentials are a revocation/accountability boundary, not per-repository or per-user isolation.

Runtime secrets belong in Cloudflare. The Jules key is sent only to the fixed Google origin; callers’ credentials are never forwarded upstream. Owner GitHub login requires the configured stable numeric ID and does not retain the login access token. Service credentials contain at least 256 random bits; only SHA-256 verifiers are stored in the Worker secret registry.

OAuth persistence is eventually consistent. Sequential replay/revocation tests do not prove instantaneous global enforcement. See [threat model](docs/threat-model.md) and [operations](docs/operations.md) for propagation, emergency disable, recovery and sensitive-log precautions.

`scan-public.mjs` is a limited offline pattern scanner. It is not a comprehensive secret scanner, a penetration test, or a substitute for GitHub secret scanning/push protection and dependency alerts. Enable those repository controls before public collaboration.
