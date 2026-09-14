# Upstream verification record

Checked on **14 September 2026**. These are primary documentation/source references, not evidence of an installed dependency graph or a live deployment. Recheck evolving interfaces when resolving dependencies and before release.

## Hosted-client architecture

- OpenAI developer mode: https://developers.openai.com/api/docs/guides/developer-mode
- OpenAI Help Center: https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta
- OpenAI MCP/plugin authentication: https://developers.openai.com/plugins/build/auth

The developer guide describes web read/write MCP and includes Pro among eligible plans. The Help Center separately describes Pro custom MCP as read/fetch-only. These statements conflict; no conclusion about this particular account's writes was inferred. The selected path is remote OAuth with pre-registered static client credentials and the exact current setup-interface redirect. No arbitrary bearer-header input in ordinary ChatGPT setup is assumed. Bearer support in another product/API does not establish support here. Host confirmations are not bypassed.

## Cloudflare runtime, auth and testing

- Stateless remote MCP: https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/
- OAuth provider: https://github.com/cloudflare/workers-oauth-provider
- Current SDK v2 example: https://github.com/cloudflare/agents/blob/main/examples/mcp-worker/src/server.ts
- Actual factory wrapper: https://github.com/cloudflare/agents/blob/main/packages/agents/src/mcp/server/handler-stateless.ts
- Worker limits: https://developers.cloudflare.com/workers/platform/limits/
- KV pricing/limits: https://developers.cloudflare.com/kv/platform/pricing/
- Native rate-limit bindings: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Vitest integration: https://developers.cloudflare.com/workers/testing/vitest-integration/
- Current test setup: https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/
- Current outbound test mocking: https://developers.cloudflare.com/workers/testing/vitest-integration/mock-outbound-requests/
- CI deployment: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/

Current examples use the SDK v2 `McpServer` from `@modelcontextprotocol/server` and the stateless `createMcpHandler` factory from `agents/mcp/server`. The factory rejects legacy stateful options, so they are not copied into this project. Auth uses supported provider helpers, resource metadata, explicit disabling of open DCR/CIMD and scoped token props. The new Workers Vitest package is `@cloudflare/vitest-plugin`; the old pool/fetchMock examples were not treated as current.

Free planning figures checked were 100,000 Worker requests/day and 10 ms CPU/request; KV 100,000 reads/day, 1,000 writes/day and 1 GB storage. These are not measured deployment results. Native rate limiting is approximate/location-based. Its acceptance on the selected Free account still requires actual deployment; an example discussing free/paid customers is not proof of plan eligibility. No billing upgrade is authorised.

### Source snapshots used to choose exact direct versions

| Source                         | Selected version / source identity                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| workers-oauth-provider package | 0.10.3; package blob `f25da891e4e01dd9a7945df04d962696b880fffc`                       |
| OAuth provider implementation  | `e560c8915f32e271d546ff6eae0317f28488a7be`                                            |
| agents package                 | 0.23.0 from current source manifest                                                   |
| agents current MCP example     | `112f6a3df3a5156cd1fab385cc98e513d8fc4740`                                            |
| agents stateless handler       | `28524edc3113723802225802aa18f3f11354c9d5`                                            |
| official MCP packages          | server/client 2.0.0; legacy SDK 1.30.0 as used by current Cloudflare source manifests |
| Zod / TypeScript / Wrangler    | 4.5.4 / 6.0.3 / 4.115.0 from current example manifests                                |
| Workers Vitest plugin          | 1.1.9; package blob `9085ee58a9ba5400597670686a1e07a77880e3e1`                        |
| Vitest                         | 4.1.8; new plugin peer range is ^4.1.0                                                |

These are **source-based selections**. npm publication, actual transitive dependencies, peer compatibility and lockfile integrity could not be verified in the sandbox. `pnpm bootstrap` must resolve those before release. No dependency tarballs were copied or relabelled.

## Jules API and existing MCP package

- Alpha API/authentication: https://jules.google/docs/api/reference/
- Sources: https://jules.google/docs/api/reference/sources/
- Sessions: https://jules.google/docs/api/reference/sessions/
- Activities/artifacts: https://jules.google/docs/api/reference/activities/
- Google quickstart: https://developers.google.com/jules/api
- Existing package: https://github.com/google-labs-code/jules-sdk/blob/main/packages/mcp/README.md

The existing `@google/jules-mcp` README was inspected at blob `0372d91d1e45c4281f80bd18d8fa8de135041890`. It describes local npx execution, a local cache and review/session tools, under Apache-2.0, and says the project is not officially supported by Google. This implementation does not copy that code: it addresses the remote authenticated Worker deployment and complete documented control surface without importing a process/local-cache architecture. See the reuse ADR and third-party notices.

Jules remains experimental at `/v1alpha`. Session deletion is documented; cancellation/merging are not invented. Repository-less creation and AUTO_CREATE_PR are documented. A canonical source name is taken from Google rather than constructed from owner/repo. The checked source example has the opaque flat form `sources/github-myorg-myrepo`; strict resource path validation is not a repository-name mapping rule. Change sets come from activity artifacts. Activity `createTime` appears in an example but not the main parameter table, and the coverage document records that uncertainty.

## Protocol/client references

- MCP authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP transport: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP tools: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- Codex MCP: https://learn.chatgpt.com/docs/extend/mcp
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Grok API MCP: https://docs.x.ai/developers/tools/remote-mcp

The dated MCP references establish protocol principles, not a hard-coded latest-version claim; negotiation belongs to the SDK. Documented CLI/API capabilities are not completed gateway trials. Grokbot, OMP and consumer Grok must each be verified independently; no product was substituted for another.

## CI action pins

GitHub's read API resolved the selected v4 tag refs to these commit SHAs on the evidence date: checkout `11d5960a326750d5838078e36cf38b85af677262`; setup-node `49933ea5288caeca8642d1e84afbd3f7d6820020`; upload-artifact `ea165f8d65b6e75b540449e92b4886f43607fa02`. This verifies tag resolution, not an exhaustive audit of those action implementations. Workflows use those fixed revisions, minimum token permissions and bounded artifact retention.

## Dependency-aware continuation verification

On 14 September 2026, npm registry metadata was queried for every direct dependency, and a real pnpm 10.13.1 lockfile was generated. See [dependency review](dependency-review.json). Local Workerd tests now validate provider/handler integration, including legacy and v2 official SDK clients. These results do not establish live account support.

Google's MCP README was retrieved again at content SHA `0372d91d1e45c4281f80bd18d8fa8de135041890`; its local-process/cache approach remains unsuitable for this small stateless Worker. No upstream code was copied.

The [handler API](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/) confirms the v2 factory and legacy stateless lane. The [Jules quickstart](https://developers.google.com/jules/api) and [sources reference](https://jules.google/docs/api/reference/sources/) show different source ID shapes; the gateway accepts both safely. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) and [rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) were rechecked. The binding's selected-account Free eligibility still requires deployment evidence.

The [OpenAI developer guide](https://developers.openai.com/api/docs/guides/developer-mode) still describes Pro read/write support while the [Help Center](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta) says Pro read/fetch only. This remains an unresolved documentation conflict, not a measured account limitation.
