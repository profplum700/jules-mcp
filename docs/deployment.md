# Deployment: GitHub Actions → Wrangler → Workers Free

The isolated Stage-0 Worker is deployed; its assessment concluded **no-go for advancement because of CPU overruns**. Owner consent and diagnostic secrets are already configured. Production is not deployed and remains gated; do not enter a Jules key. See the [assessment](stage-zero-assessment.md) and [current evidence](implementation-status.md).

## 1. Resolve and validate the dependency graph

The genuine lockfile and full local validation are now complete. Use Node 22.18+ or Node 24 and the pinned package manager:

```sh
npm install --global pnpm@10.13.1
pnpm install --frozen-lockfile
pnpm check
pnpm audit --prod --audit-level=high
```

Use a complete Git clone: the public-file scan also examines all reachable historical blobs and rejects shallow clones. Checked-in JSONC configs intentionally use strict JSON syntax so the dependency-free renderer can parse them; Prettier preserves that constraint. Do not deploy until the same commit passes hosted CI and the separate Stage-0 gate.

From a downloaded source archive, initialise and publish using your own authenticated Git tooling. From the supplied Git bundle, clone it normally. Use a public repository. Enable GitHub dependency alerts, security updates, secret scanning/push protection and private vulnerability reporting where offered. Protect `main` with `CI / core-offline` and `CI / validate`, review requirements and no automatic merges. No repository-setting change is claimed to have been performed by this prototype.

## 2. Bootstrap the separate feasibility environment

In Cloudflare, use an account on **Workers Free**. Do not approve a paid-plan upgrade. Enable the account’s workers.dev subdomain and create one small KV namespace dedicated to this feasibility Worker. Reserve three distinct numeric rate-limit namespace IDs that are not used by another deployment in this account. There is no paid WAF rule, Access, DO, Tunnel or domain requirement.

Create a GitHub environment named `feasibility`, restricted to trusted `main`, with a required owner review where available. The deployment action installs dependencies before its Cloudflare token is injected into the final deploy step. Add:

| Environment variable        | Value                                                             |
| --------------------------- | ----------------------------------------------------------------- |
| `WORKER_NAME`               | Your chosen name ending in `-feasibility`.                        |
| `PUBLIC_ORIGIN`             | Exact HTTPS workers.dev origin for that Worker; no `/mcp` suffix. |
| `RATE_AUTH_NAMESPACE_ID`    | First account-unique positive numeric ID.                         |
| `RATE_READ_NAMESPACE_ID`    | Second distinct numeric ID.                                       |
| `RATE_CONTROL_NAMESPACE_ID` | Third distinct numeric ID.                                        |
| `CONFIRMED_FREE_PLAN`       | `true` only after checking the target account.                    |
| `GATEWAY_DISABLED`          | Initially `true`.                                                 |

Environment secrets are `CLOUDFLARE_ACCOUNT_ID`, `OAUTH_KV_NAMESPACE_ID` and a scoped `CLOUDFLARE_API_TOKEN`. Use Cloudflare’s minimum deployment permissions for the selected account (Worker scripts; existing KV access as required); do not grant billing, zone, DNS or unrelated account rights. Namespace creation happens at bootstrap, not on every deployment. Never grant a runtime Worker the deploy token. Confirm the available permission granularity in Cloudflare rather than claiming token isolation narrower than the interface actually offers.

Run **Deploy**, selecting `feasibility`, from `main`. It repeats validation first, then renders `.deploy/wrangler.json` with explicit private values and deploys the exact triggering commit. A configured deployment workflow is not evidence that a deployment has occurred.

The initial Stage-0 bootstrap used the authorized Cloudflare plugin to upload Wrangler's exact dry-run multipart artifact because local Wrangler credentials had expired. This is an isolated diagnostic bootstrap, not a second production deployment route. With current Wrangler, `--outfile` contains the multipart upload body, not a JavaScript module: preserve its boundary and metadata when uploading through the API. The upload, bindings and workers.dev route were independently re-fetched. Production still requires the protected GitHub Actions route below.

If Cloudflare rejects rate-limit bindings on the Free account, stop this release gate. Do not approve a paid upgrade or replace the limiter with an inaccurate global in-memory/KV counter. The initial Stage-0 account accepted all three bindings; each new deployment still requires its own eligibility check.

## 3. Enter owner-login and credential secrets

Register the GitHub owner-login OAuth app with that Worker’s exact callback. In Cloudflare’s runtime secret interface, set `OWNER_GITHUB_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ADMIN_TOKEN_SHA256` and `SERVICE_TOKENS_JSON` as described in [authentication](authentication.md). The separate diagnostic entrypoint needs **no Jules API key**.

Generate admin/client credentials locally using the included scripts. No secret is printed. For CLI secret application, render the same `.deploy/wrangler.json` locally using the environment values above plus `GATEWAY_MODE=feasibility` and `BUILD_COMMIT` equal to the validated commit. Feed private files to `wrangler secret put`; do not put values into shell arguments or GitHub issues.

After secrets are in place, set the environment variable `GATEWAY_DISABLED=false` and run **Deploy** again. The `--message` records the exact commit in Cloudflare’s version history. Runtime secrets are not sent from PR workflows and are not overwritten by the generic renderer.

For a new deployment, pre-register ChatGPT with the exact redirect URI supplied by its current UI, enter that client’s static OAuth credentials in that UI and perform the [Stage-0 trial](feasibility.md). Owner authorization must be observed in the actual client. It was completed for the assessed diagnostic deployment.

## 4. Production only after Stage 0 passes

Create a separate protected GitHub `production` environment, Worker name, auth KV namespace and rate-limit namespaces. Use production-specific owner-login app/callback, admin credential, client credentials and Jules key. Do not reuse test credentials/KV or point the two environments at one Worker. A separate GitHub OAuth app avoids callback-origin confusion.

Apply the same environment settings and runtime secrets. Add `JULES_API_KEY` only through Cloudflare’s secret interface. Connect any desired repository to Jules in Google’s own account UI; the gateway needs no second repository allowlist.

Run **Deploy** selecting `production`, then `pnpm smoke:readonly` with a private read-only service credential. Stage-0 tools are absent from the production entrypoint. Refresh ChatGPT’s tool definitions after connecting the production endpoint. Live mutation testing is limited to an explicitly designated disposable repository; the project has no automatic mutation CI workflow.

## Operations and recovery

The sole reference production path is GitHub Actions, not simultaneous Cloudflare Builds. The workflow uses standard hosted Linux runners, exact action SHAs, frozen installation, validation before credential injection, a protected environment and one deployment concurrency group. It does not auto-merge or auto-publish releases.

Rollback, disable, revocation and CPU/quota measurement procedures are in [operations](operations.md). Keep the actual tested/deployed commit, Cloudflare version and client results in a private deployment record; do not publish account IDs or raw logs.
