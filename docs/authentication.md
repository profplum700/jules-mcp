# Authentication and credential lifecycle

## Runtime configuration

All values below are entered through Cloudflare’s secret interface or a trusted local Wrangler prompt/file input, never chat, public source or CI PR secrets.

| Secret                 | Purpose                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `OWNER_GITHUB_ID`      | Stable numeric GitHub user ID authorised to connect clients. Never match a mutable login name. |
| `GITHUB_CLIENT_ID`     | Owner-login OAuth app registered with GitHub.                                                  |
| `GITHUB_CLIENT_SECRET` | GitHub owner-login app secret.                                                                 |
| `ADMIN_TOKEN_SHA256`   | SHA-256 verifier of a separately generated owner admin credential.                             |
| `SERVICE_TOKENS_JSON`  | Small JSON array of service-token verifiers; use `[]` for OAuth-only deployment.               |
| `JULES_API_KEY`        | Google Jules key. Required for actual Jules calls, not Stage 0 or gateway-info.                |

The generic renderer supplies non-secret `PUBLIC_ORIGIN`, `GATEWAY_DISABLED`, `BUILD_COMMIT` and `ALLOWED_ORIGINS_JSON`. All protected routes fail closed on missing/malformed security settings. `/healthz` reports only process aliveness, not readiness or configuration status. No credentials can be recovered through MCP.

`PUBLIC_ORIGIN` is a canonical HTTPS origin without path, userinfo, query, fragment or explicit non-default port. Alternative hostnames cannot acquire the same audience implicitly. Origins absent on server-to-server MCP requests are accepted; present browser Origins must match the full configured origin list exactly. Do not add `*`.

## Service clients

```sh
node scripts/generate-client-credential.mjs codex
node scripts/generate-client-credential.mjs reviewer --read-only
```

Tokens and the combined verifier registry are written only into `.private/`, with restrictive local permissions. The raw format is `jmg_ID.<256-bit-random-base64url>`. Names identify credentials; they are not secrets, identities of models, or entropy sources. Raw tokens never enter Worker configuration: only their SHA-256 verifiers do.

After private deployment configuration is rendered:

```sh
pnpm exec wrangler secret put SERVICE_TOKENS_JSON --config .deploy/wrangler.json < .private/service-tokens.json
```

For rotation and revocation:

```sh
node scripts/generate-client-credential.mjs codex --rotate
# Apply the updated registry; put the replacement token into that client only.
node scripts/revoke-client-credential.mjs reviewer
# Apply the registry again, then test reviewer denial and another credential’s success.
```

The scripts modify local files, not Cloudflare, until the explicit secret application step. Keep copies in a password manager or trusted credential store. Filesystem permissions on Windows do not replace Windows ACLs. Refuse to share a service token among clients that need independent revocation. At most 12 entries and 4 KiB registry are accepted. Optional ISO `expiresAt` and `revoked` fields are validated. Remove obsolete entries periodically.

## Hosted OAuth clients

Create a GitHub OAuth application in the provider interface. Homepage is the canonical gateway origin; callback is exactly `/oauth/github/callback` on that origin. No GitHub repository or email scope is requested. The application uses GitHub identity only, not GitHub repo permissions or a Jules delegated OAuth token.

Generate the separate bootstrap/admin credential:

```sh
node scripts/generate-admin-credential.mjs
pnpm exec wrangler secret put ADMIN_TOKEN_SHA256 --config .deploy/wrangler.json < .private/admin.sha256
```

With all settings present and the gateway enabled, pre-register the hosted client using its **actual UI-provided redirect URI**. Set `GATEWAY_ORIGIN` in your private local environment, then run:

```sh
node scripts/oauth-admin.mjs create-client chatgpt "$CHATGPT_REDIRECT_URI" client_secret_post
```

The generated client record (including any client secret) is saved in a private local JSON file, not printed. Enter its credentials in the hosted client’s own trusted configuration UI. The two OAuth applications are different: GitHub identifies the owner; the registered MCP client authenticates ChatGPT to this gateway.

Use `client_secret_basic` or `none` only when the actual client requires it. All authorization-code connections still require S256. Each client registers one exact HTTPS redirect. Authorization additionally requires a concrete DNS hostname (including punycode) and supports explicit numeric HTTPS ports; wildcard or delimiter-bearing hosts, IPv6 literals, userinfo and fragments are rejected before consent. The consent CSP includes only the selected registered origin, GitHub and self. Arbitrary metadata document fetching and open dynamic registration remain disabled. Loopback-only OAuth clients can use independent service credentials instead in this prototype. Add support only from a verified client need.

One connection consent screen is not a per-action approval queue. After authentication, control clients invoke supported actions directly, subject only to the host’s own confirmation policy.

## OAuth revocation

```sh
node scripts/oauth-admin.mjs list-grants
# Read the private result locally. Follow its cursor when present.
node scripts/oauth-admin.mjs revoke-grant "$GRANT_ID"
node scripts/oauth-admin.mjs delete-client "$CLIENT_ID"
```

Grant listing is paginated (10 at a time), and revocation/client deletion use the provider’s helpers. The admin API cannot be called using ordinary OAuth or service MCP credentials. It rejects requests with an Origin header, including browser-originated writes. The high-entropy admin credential is a separate owner bootstrap secret; do not put it into an MCP client or runtime Jules configuration.

Revocation may propagate through eventually consistent KV and Worker secret deployments rather than immediately worldwide. Verify denial and an unaffected client at the deployed endpoint. An interrupted provider revocation may require owner inspection/repetition; never label it a completed global revoke merely because a local script wrote a file. See operations for emergency disable and Jules-key rotation.

## Installed-provider verification

The local Workerd suite exercises the maintained provider's S256 exchange, wrong PKCE/resource rejection, sequential code replay, scope reduction on refresh, and grant revocation. The provider enforces the configured exact resource; its token-exchange callback exposes identity/scopes but does not expose a `resource` property. GitHub identity requests use manual redirects and reject non-success statuses. No GitHub token is retained. These are local synthetic identity tests, not live GitHub/ChatGPT consent evidence.
