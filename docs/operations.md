# Operations

## Credential revocation and emergency disable

For one machine client, revoke its row with the owner script and apply the updated `SERVICE_TOKENS_JSON` runtime secret. Test that credential is rejected while another works. For OAuth, list grants and revoke the selected grant through the provider helper; delete the client registration when that client should no longer reconnect. Do not edit the provider’s opaque KV records manually.

KV and deployments are eventually consistent. No instantaneous worldwide revocation claim is made. A successful API response or local file change must not be substituted for propagation evidence. Record the tested locations/time, if available, without tokens.

For an emergency, disable the affected Worker’s public workers.dev/custom-domain routes in the Cloudflare interface, or apply `GATEWAY_DISABLED=true` and deploy a trusted commit. Every protected route checks the kill switch; `/healthz` remains only an aliveness response. Routing/deployment changes also have propagation time. Re-enable only after rotating compromised credentials and verifying the known-good version.

If the Jules key is compromised, revoke/rotate it directly in Google’s trusted account interface, replace `JULES_API_KEY` in Cloudflare and verify reads. Rotate the admin/GitHub app credentials separately if affected. Do not publish the old values as a remediation example. Disabling the gateway or revoking its Jules key prevents new gateway access; it does **not** guarantee an already-running upstream Jules task stops. The documented session-delete operation is not represented as cancellation.

## Rollback

Record the deployed commit and Cloudflare version after each deployment. GitHub Actions’ validated triggering SHA and Wrangler’s `commit:SHA` version message provide traceability. For code rollback use Cloudflare’s version/deployment interface to select a known-good prior deployment. Verify the runtime secret set and bindings as well: code rollback is not an assertion that secrets or KV grant state have been rolled back. Do not restore a compromised credential registry.

Exercise rollback first on the separate feasibility deployment. The isolated Stage-0 disable/version-rollback rehearsal is recorded in implementation-status.md: protected access was disabled, then the previously verified version restored SDK access while revoked credentials remained denied. Do not tag a production release based solely on a generated configuration or dry run.

## Limits and failure behaviour

The default gateway limits are application ceilings, not a provider guarantee:

| Dimension                   | Initial ceiling                                                                  |
| --------------------------- | -------------------------------------------------------------------------------- |
| Entire request              | 20 seconds wall time                                                             |
| Counted external operations | 20, including KV/limiter and HTTP work                                           |
| Inbound body                | 65,536 bytes                                                                     |
| Jules/identity body         | Jules 262,144 bytes; GitHub identity 32,768 bytes                                |
| Structured tool result      | 60,000 characters                                                                |
| MCP transport response      | 524,288 bytes                                                                    |
| List page                   | 20 default; 1–100 permitted                                                      |
| Resolver                    | Up to 8 pages of 100 connected sources, also constrained by remaining operations |
| Patch output                | 20,000 UTF-16 units default; 40,000 maximum requested                            |
| Auth/ingress limiter        | 60 requests/minute per hashed transport IP, approximate                          |
| Read tools                  | 60/minute per credential, approximate                                            |
| Control tools               | 10/minute per credential, approximate                                            |

Native rate limiting is approximate and location-oriented. Different locations can admit more aggregate requests. Hosted clients may share source IPs. The ingress limiter is a broad abuse brake, not an exact invalid-login or Jules spend counter. No global daily task-spend guarantee is provided. KV quota exhaustion, Worker request exhaustion and CPU limits can make the endpoint unavailable.

Smaller deployment limits can be supplied through `LIMITS_JSON` as a runtime secret/config value; the parser does not allow ceilings above the reviewed defaults. Avoid tuning before measuring.

A resolver which reaches its budget returns `RESOLUTION_INCOMPLETE`, candidates and continuation. A caller-supplied continuation cannot prove uniqueness in earlier pages, so the result stays incomplete; choose a returned canonical source explicitly to proceed safely. No first-page “not connected” error is returned. Very large individual upstream artifacts exceeding 256 KiB cannot be sliced by this gateway because Jules returns the containing event as a whole; the error is explicit. No false full-review claim is made.

## Ambiguous mutation outcomes

Creation, messaging, approval and deletion are never automatically retried. Network failure, an unreadable/malformed success body or a server failure can mean Jules accepted the action even though the caller did not receive a usable result. Inspect sessions/activities before deciding whether to repeat. There is no invented upstream idempotency key or deduplication store. A request ID is correlation only.

Reads may retry up to twice, within the total budget and short jitter/Retry-After limits. Long Retry-After yields a safe error/suggestion rather than a sleeping Worker. Distinct errors identify invalid credentials/scopes, unconnected or incompletely resolved repositories, quota limits, missing/expired resources, invalid task state, input/output limits and unknown outcomes.

## Logs and measurements

Application logs are a strict allowlist: generated request ID, verified opaque client ID, known tool name, finite result category, elapsed time and safe numeric status. They exclude prompts, replies, code, diffs, headers, URLs, OAuth codes, exception stacks and raw provider errors. CI fixtures and reports are synthetic.

Persistent platform observability is off by default to avoid automatic request-URL logging on OAuth callback paths and unreviewed storage use. On-demand provider logs and account audit trails may still contain metadata outside the application’s logging control. Never export raw `wrangler tail` events containing callback/token URLs into public CI reports or chat. To qualify Free CPU, use Cloudflare’s private request metrics/invocation view and record only numeric CPU/wall-time/request-size aggregates; review any platform logging configuration before enabling retention. A JSON “log scrubber” alone is not proof that provider-side URL records were never stored.

Cloudflare’s documented Free allowances at inspection were 100,000 Worker requests/day with a 10 ms CPU budget, and KV 100,000 reads/day, 1,000 writes/day and 1 GB storage. Check the current account and docs again; account-wide usage shares those allowances. The native limiter’s acceptance on the selected Free account and actual cold/warm CPU remain release gates. No paid resource or plan upgrade is authorised.

## Live test safety

The readonly smoke script connects with the official SDK, discovers tools and invokes gateway-info or Stage-0 read. It deliberately creates no Jules tasks. For later full-control qualification, designate a disposable repository explicitly, create a tiny session there, inspect/continue via a second credential, exercise approval on an appropriate pending plan, inspect artifacts, and delete only that disposable session. Do not merge its PR. No live mutation workflow is run by normal CI or deployment.

Current evidence: both Wrangler dry runs and native limiter Workerd tests pass. The isolated diagnostic deployment has live CPU samples and observed client revocation denial, recorded in implementation-status.md. Sampled CPU overruns keep Free qualification open. Cold-isolate identification, exact billed per-flow KV counts and a global revocation propagation bound are not established.
