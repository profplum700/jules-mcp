# Stage 0: ordinary ChatGPT OAuth feasibility

## Current evidence

The transport and maintained OAuth integrations pass local Workerd and SDK-client tests. The isolated diagnostic Worker is now deployed on a confirmed Workers Free account with dedicated auth KV and all three native rate-limit bindings. Owner-login secrets are deployed; a bounded confidential-client trial is enabled. Live SDK and actual Codex CLI diagnostic write/read-back succeeded. ChatGPT completed owner OAuth login, discovered both diagnostic tools and passed a read, single write and immediate nonce read-back. Stage 0 remains **open**, not passed and not disproved.

The real Pro web account exposes Create app, user-defined OAuth client credentials, client_secret_basic/client_secret_post, scope fields and a generated callback URL. Live discovery, OAuth authentication and the benign diagnostic write/read-back are verified; reconnect, token refresh and grant revocation remain open. The existing Workerd diagnostic test now removes JULES_API_KEY and asserts zero outbound HTTP during tool discovery, nonce write and read-back.

OpenAI’s developer-mode documentation describes full MCP reads/writes for Pro web accounts, while its Help Center still describes Pro custom MCP as read/fetch-only. Both were checked on 14 September 2026. A practical account test is necessary. The UI can change; do not infer a hidden bearer-header field from Codex/API configuration.

## Harmless trial

Deploy the separate feasibility environment using the documented OAuth configuration, without a Jules key. It registers only:

- `jules_feasibility_read`: returns the verified principal; optionally confirms a nonce written by that credential.
- `jules_feasibility_write`: truthfully annotated write, storing only a random nonce in authentication KV for 120 seconds. It has no user-content argument, does not call Jules and touches no repository.

In the actual ChatGPT web account, open the currently available developer-mode/custom-app controls. Start creating the remote app with its HTTPS `/mcp` URL and OAuth. Copy the redirect URI from that current setup surface into the **local** owner pre-registration command. Enter the generated OAuth client ID/secret back in the app’s own UI, not chat. Authenticate through GitHub as the configured owner, then complete connection consent.

Ask ChatGPT to list the connected diagnostic tools, call the read tool, call the benign write and read back its returned nonce. Allow any normal ChatGPT host confirmation; do not change the tool annotation to avoid it. Refresh/reconnect and repeat a read. Revoke only this client’s grant through the owner script; verify it fails while a second service client remains usable. Use `pnpm smoke:readonly` to test the separate bearer path with the official SDK client.

If the UI has no custom-app controls, does not permit static OAuth credentials, will not scan the tools or refuses writes because of an account policy, record the exact observed surface/message. Do not weaken auth, enable open registration or declare a Pro-wide limitation based on one failure. If pre-registration is demonstrably unsupported, a narrowly scoped CIMD/DCR design is follow-up engineering, not something silently enabled here.

## Record required evidence

Use `docs/client-trial-template.json` privately. Record UTC time, exact browser/app version, account/workspace type, auth method, tested commit, Cloudflare version, tool scan/read/write/reconnect/revoke outcomes, host confirmations and any exact safe failure message. Never record an access token, OAuth code, URL query containing a code, prompts or private repository names.

Measure Cloudflare Worker CPU for cold/warm discovery, valid/invalid auth, OAuth code/refresh exchange and representative payloads. Node wall-clock timing is not a substitute. Confirm native limiter eligibility and KV/Worker allowance consumption on the actual Free account. If the 10 ms CPU budget is exceeded, do not silently buy more CPU.

The web account trial does not establish Android support. Grokbot requires its own actual product test; a Grok API result is not equivalent. Remove the feasibility deployment and its credentials when no longer needed. The production entrypoint must remain diagnostic-free.
