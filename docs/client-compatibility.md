# Client compatibility

Status as of 14 September 2026. “Documented path” is not “tested this gateway.” No real MCP client has connected to a deployed gateway in this implementation session.

| Client/surface                                     | Intended path                                                      | Evidence and status                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary ChatGPT web chat                          | Remote Streamable HTTP + pre-registered OAuth + S256               | Documentation describes a path, but Pro write-policy pages conflict. Actual account **not tested**; no deployed endpoint; account connection has not been attempted. Stage 0 is the priority. |
| ChatGPT Android                                    | Same account service where mobile exposes it                       | **Not tested**; web success would not establish mobile support.                                                                                                                               |
| ChatGPT Work / Codex cloud                         | That environment’s supported hosted MCP/plugin route               | **Not tested**; local CLI settings are not a cloud compatibility result.                                                                                                                      |
| Codex CLI/IDE                                      | Remote HTTP with a dedicated bearer credential, or supported OAuth | Documented route exists; this gateway **not tested** in an actual Codex client.                                                                                                               |
| Claude Code                                        | Remote HTTP with its own credential / supported OAuth              | Documented route exists; **not tested** in actual Claude Code.                                                                                                                                |
| OMP                                                | The installed OMP version’s actual MCP implementation              | **Not tested**; no exact installed version/config inspected. Do not assume Pi and OMP have identical support.                                                                                 |
| Grokbot                                            | Its actual product connector surface                               | **Not tested**; no live product/config access. Remains a priority trial, distinct from Grok API.                                                                                              |
| Grok API                                           | Remote MCP with supported authorization/headers                    | Documented API route exists; **not tested** against this gateway.                                                                                                                             |
| Consumer Grok app                                  | Whatever custom-tool interface that account offers                 | **Unverified**; do not infer support from the Grok API.                                                                                                                                       |
| Official TypeScript MCP SDK 1.30.0 / 2.0.0 clients | Streamable HTTP bearer path via bundled script                     | **Tested successfully locally** using the official SDK against Workerd through a fetch adapter: discovery, read, benign write, reconnect and revocation. Internet smoke script not run.       |
| MCP Inspector                                      | Diagnostic remote connection                                       | Recommended diagnostic after install/deploy; **not run**, no compatibility claim.                                                                                                             |

## Configuration conventions

Endpoint is the deployment’s exact HTTPS origin plus `/mcp`. Do not append an untrusted proxy URL or encode a token into the URL. Each machine client gets a distinct service credential. Read it from that client’s supported environment/secret store; do not embed a real token in checked-in configuration or shell command arguments.

Codex’s documented local configuration supports `bearer_token_env_var`. A generic example, with no credential value, is:

```toml
[mcp_servers.jules]
url = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp"
bearer_token_env_var = "JULES_GATEWAY_TOKEN"
```

Use this only in a client version which supports that setting; it is not a Codex cloud configuration. For Claude Code, OMP and Grokbot, verify the installed client’s actual authentication syntax rather than copy an untested guess into this repository. The client-neutral external contract is authenticated Streamable HTTP, not an app-specific local shell launcher.

For ChatGPT, follow the separate Stage-0 OAuth runbook. Do not assume an arbitrary Authorization-header field exists in ordinary chat. The gateway advertises real write annotations; allow normal host confirmations. Refresh tool definitions after schema changes and after switching from diagnostic to production deployment.

Use `client-trial-template.json` privately for actual evidence. Promote a row to “tested successfully” only after recording the surface/version, auth method, deployed commit/version and operations. Never substitute a Grok API test for Grokbot, or a Node mocked test for an MCP client result.
