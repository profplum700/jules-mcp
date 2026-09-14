import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { Principal } from '../auth/principal.ts';
import { RequestBudget } from '../shared/limits.ts';
export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  AUTH_LIMITER: RateLimit;
  READ_LIMITER: RateLimit;
  CONTROL_LIMITER: RateLimit;
  PUBLIC_ORIGIN: string;
  OWNER_GITHUB_ID: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  JULES_API_KEY?: string;
  SERVICE_TOKENS_JSON: string;
  ADMIN_TOKEN_SHA256: string;
  ALLOWED_ORIGINS_JSON?: string;
  LIMITS_JSON?: string;
  GATEWAY_DISABLED: string;
  BUILD_COMMIT?: string;
}
/** Counts KV operations alongside HTTP calls. No task or audit data is persisted here. */
export function budgetKv(kv: KVNamespace, budget: RequestBudget): KVNamespace {
  return new Proxy(kv, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        budget.take();
        return budget.run(Promise.resolve(Reflect.apply(value, target, args)));
      };
    },
  });
}
export async function rateLimit(
  env: Env,
  control: boolean,
  principal: Principal,
  budget: RequestBudget,
): Promise<boolean> {
  budget.take();
  return (
    await budget.run(
      (control ? env.CONTROL_LIMITER : env.READ_LIMITER).limit({ key: principal.credentialId }),
    )
  ).success;
}
