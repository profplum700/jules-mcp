# Stage-0 assessment: no-go for advancement

Assessment completed on 15 September 2026 for diagnostic runtime `17d0a30f68254394a81946c0351403a8b0d83dbd`. **The tested implementation does not qualify for advancement under the Workers Free CPU requirement.** This is a completed feasibility assessment with a negative result, not a successful feasibility gate or a production release.

## Requirement-to-evidence audit

| Requirement                                                        | Evidence                                                                                                                                                                                                                     | Disposition                                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Continue the existing project and preserve boundaries              | Existing main preserved; isolated continuation branch; production schema baseline unchanged; policy and credential-history scans pass                                                                                        | Met                                                               |
| Confirm Free eligibility and quotas                                | Actual dashboard Free plan; dedicated auth KV and three native limiters accepted and independently read back; account usage inspected; source-derived per-flow KV allowance model in feasibility.md                          | Eligibility observed; CPU suitability failed                      |
| Deploy isolated diagnostics without Jules                          | Exact Wrangler artifact deployed through authorized Cloudflare API; configuration and five secret names independently read back, no Jules key; Workerd asserts zero diagnostic outbound HTTP                                 | Met                                                               |
| Owner-only maintained OAuth and separate credentials               | Stable numeric GitHub owner ID, minimal identity login, pre-registered confidential client, S256, exact callback/resource validation; independent admin/service credentials; security regressions pass                       | Met for tested confidential-client configuration                  |
| Verify actual ordinary ChatGPT web behavior                        | Personal Pro web account, model selector 6 Pro: discovery, owner login, two tools, read, single nonce write/read-back, natural-expiry refresh, selected-grant revocation denial and returning-user reconnect observed        | Met for this account and surface                                  |
| Verify an actual coding client                                     | Codex CLI 0.154.0 called the remote diagnostic write and read back its nonce through a dedicated bearer credential                                                                                                           | Met; no IDE/cloud/OAuth extrapolation                             |
| Measure representative live behavior                               | Exact-version adaptive CPU samples, request timestamps and first-observed/later request classes retained privately; successful service and hosted OAuth trials still contain above-target samples                            | Measured; Free CPU gate not passed                                |
| Validate and publish changes                                       | Full gate: 192 core and 22 Workerd tests; unchanged diagnostic tool definitions; independent Linux frozen install, full check and audit [run 34909194669](https://github.com/profplum700/jules-mcp/actions/runs/34909194669) | Met for runtime candidate                                         |
| Recovery and revocation                                            | Kill switch returned protected 503 and health 200; version rollback restored authenticated read; revoked service remained 401 while retained service returned 200                                                            | Observed; no global propagation bound or secret/KV rollback claim |
| Production secrets and Jules tests only after feasibility succeeds | No feasibility pass, no Jules key, no production deployment, no live Jules mutation or PR merge                                                                                                                              | Conditional work correctly remains gated                          |

## CPU finding and bounded experiment

The fixed diagnostic Zod schemas were moved to module constants; request-local servers, handlers, principals, configuration and budgets were preserved. Full tool definitions matched the deployed baseline. Same-module valid-invalid-valid checks, concurrent diagnostic credential isolation, read-only denial before storage, and no-key/no-fetch assertions pass. Actual ChatGPT and service-client functional checks also passed after deployment.

The exact-version samples still include 14.879 ms on the first recorded service initialization, 18.883 ms in a separate retained-service check and 17.896 ms in the hosted OAuth window. Later sampled requests were approximately 2.4–4.9 ms. These are small adaptive observations, not a stable workload P99 or proof of cold-isolate execution. Zero errors does not negate the above-target CPU observations. No causal saving from the schema change is claimed.

The final independent Pro review inspected the public candidate and pinned SDK and recommended no-go, subject to one bounded artifact check. That check confirmed the exact uploaded artifact includes the SDK workerd shim's executing module-scope preload call, reaching the same memoized wire-schema graph used by the request path. Adding another idempotent preload call would be redundant. The profiles do not establish another material removable cost; speculative small deployments were stopped.

This does **not** prove that the maintained dependency stack is inherently incapable of running on Free. Reopening qualification requires an evidence-backed performance proposal or minimal reproduction, preserved security/transport behavior, independent review and fresh deployed measurements. No paid upgrade, omitted limiter, weakened cryptography or shared authenticated state is an accepted workaround.

## Verification lanes and limits

- Static/build, schema contract, core regression, Workerd integration and independent Linux CI: passed for the runtime candidate.
- Browser/real-service: actual ChatGPT OAuth and Codex CLI diagnostics passed; GitHub login and Cloudflare deployment were exercised. Synthetic tests alone are not the acceptance evidence.
- Security/identity: independent reviews completed; owner/origin/CSP/PKCE/resource, request isolation and scope denial regressions passed. Public clients remain outside the qualified confidential-client trial; the pinned provider's previous-refresh-token reuse semantics still require a production decision.
- Performance: measured, failed qualification. Exact cold-isolate attribution and a reliable CPU remedy remain unestablished.
- Recovery: diagnostic kill switch and version rollback exercised. KV eventual consistency remains a limit on global revocation guarantees.
- Migration/golden/financial lanes: not applicable to this candidate because it changes no persisted format, rendered product snapshot contract or payment behavior. Reassess if those surfaces change. No independent fuzz campaign or general penetration-test claim is made.
- Production/Jules, Android, IDE/cloud and Grokbot: not qualified by these trials. Production is conditional on a future feasibility pass; the other client surfaces need their own actual tests if claimed.

## Operator handoff

No immediate personal login or secret entry is required. Do not enter a Jules key or promote this diagnostic version. A future production attempt also needs protected trusted-main deployment, reviewed environment/credential separation and a designated disposable repository before any mutation testing.

To revoke the diagnostic OAuth grant, use the private owner workflow in [authentication](authentication.md), select only the intended grant and verify hosted denial independently. To disable or roll back the diagnostic Worker, follow [operations](operations.md); verify the active deployment and a protected request, not health alone. Private deployment IDs, endpoint, client trial records and exact metric queries remain outside the public repository.
