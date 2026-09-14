# Threat model and residual risks

## Assets and trust boundaries

Protect the Google Jules key, owner-login GitHub secret/token, service/admin credentials, OAuth grants, private task content and account authority. The deployment owner and a control credential are trusted to operate all documented Jules actions. A read credential may inspect potentially sensitive sessions from other clients. This is not a multi-tenant or per-repository security boundary.

Untrusted surfaces include public HTTP requests, client metadata, OAuth callbacks, tool arguments, Jules response text/artifacts, package dependencies and fork pull requests. Google and Cloudflare remain service providers; the gateway cannot prevent them from processing requests. Client hosts also receive the task data their tools request.

| Threat                                 | Control                                                                                                            | Residual risk / verification                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Unauthenticated Jules access           | Maintained OAuth provider or high-entropy service token; per-request principal/scopes                              | Real provider/SDK runtime tests pass locally; no deployed production credential           |
| Credential sharing or impersonation    | Independent IDs/hashes, no client-name/User-Agent authority                                                        | A stolen trusted credential carries that client’s full scopes                             |
| Host/Origin confusion                  | Canonical HTTPS origin/audience, exact browser Origins, alternate hostname denial                                  | Actual hosted-client Origin requirements must be recorded; do not loosen to wildcard      |
| OAuth phishing/CSRF/state tampering    | Pre-registration, exact redirect, S256, escaped consent, HttpOnly SameSite cookie, random expiring state, owner ID | Host consent UI and globally concurrent KV behaviour still need deployed review           |
| Token/resource confusion               | Canonical resource metadata, provider audience checks, explicit external-token audience                            | Wrong-resource exchange rejected in installed-provider runtime tests; live test pending   |
| Dynamic-registration abuse / SSRF      | No DCR or CIMD; outbound Google/GitHub origins fixed; manual redirects with status validation                      | Login endpoints remain public quota targets when an attacker knows a client ID            |
| Privilege escalation                   | Optional read/control model; all four mutation tools require control; admin token separate                         | Host confirmation does not replace server checks; admin credential is sensitive           |
| Replay                                 | Provider handles authorization code/refresh mechanisms; owner state consumed; upstream GitHub codes single-use     | KV is not transactional; sequential synthetic tests cannot prove global replay exclusion  |
| Revocation delay                       | Provider grant/client helpers, separate service registry, emergency disable/key rotation                           | Eventually consistent propagation; no instantaneous global guarantee                      |
| Duplicate mutation after lost response | One dispatch, safe unknown-outcome result, no gateway automatic mutation retry                                     | A caller may still decide to repeat; no exactly-once/deduplication promise                |
| Resource exhaustion                    | Size/deadline/operation limits and native ingress/read/control limiters                                            | Approximate location limits and shared hosted-client IPs; Free account quota/CPU risk     |
| Prompt injection through artifacts     | Content treated as data; gateway does not interpret or execute code/artifact instructions                          | Receiving AI clients must maintain their own data/instruction boundary                    |
| Sensitive logs                         | Application allowlist; no arbitrary exception serialization; platform persistence off by default                   | Provider audit/invocation metadata outside app control; never export raw callbacks        |
| Supply-chain/fork attack               | Exact direct pins, reviewed lock gate, pinned actions, no PR secrets, hosted runners                               | Genuine lockfile and local production audit pass; hosted CI and provider controls pending |
| Accidental production diagnostic       | Separate entrypoint/name/environment, production import lint/schema test                                           | Owner must not configure both environments to the same real Worker or KV                  |

## Security configuration failure

Missing/malformed credentials, wrong canonical origin, undefined limiter/KV bindings and a disabled gateway prevent protected access. The health endpoint is deliberately unauthenticated and non-identifying; it does not expose readiness, credential IDs or account configuration. `jules_gateway_info` is authenticated and exposes only the current principal, public capabilities and configured limits.

## Not promised

No protection from an authorised control client intentionally using its documented authority. No account-wide spending cap, global exact limiter, instantaneous revocation, transactional KV state machine, perfect availability, background supervision, automatic rollback, cancellation guarantee or comprehensive audit certification. Installed-provider tests pass locally. Actual Free performance and hosted-client trials remain mandatory before a production release.
