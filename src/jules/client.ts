import { GatewayError, requireThat } from '../shared/errors.ts';
import { readLimited, RequestBudget } from '../shared/limits.ts';
import { resourceName } from './resources.ts';
import type {
  Activity,
  ActivityPage,
  CreateSession,
  JsonObject,
  ListOptions,
  Session,
  SessionPage,
  Source,
  SourcePage,
} from './types.ts';
/** This is the ONLY module which knows Jules's experimental version or origin. */
export const JULES_API_ORIGIN = 'https://jules.googleapis.com';
export const JULES_API_VERSION = 'v1alpha';
export type Fetcher = (request: Request) => Promise<Response>;
export function retryDelay(
  value: string | null,
  attempt: number,
  now = Date.now(),
  jitter = Math.random(),
): number {
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return Math.max(0, timestamp - now);
  }
  return Math.ceil(100 * 2 ** attempt + jitter * 100);
}
export class JulesClient {
  private key: string;
  readonly budget: RequestBudget;
  private fetcher: Fetcher;
  constructor(key: string, budget = new RequestBudget(), fetcher: Fetcher = (request) => fetch(request)) {
    this.key = key;
    this.budget = budget;
    this.fetcher = fetcher;
  }
  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    query: Record<string, unknown> = {},
  ): Promise<JsonObject> {
    requireThat(this.key && !/[\r\n]/.test(this.key), 'CONFIGURATION_ERROR', 503);
    const url = new URL(`/${JULES_API_VERSION}/${path}`, JULES_API_ORIGIN);
    requireThat(url.origin === JULES_API_ORIGIN, 'CONFIGURATION_ERROR', 503);
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) url.searchParams.set(key, String(value));
    const mutation = method !== 'GET';
    for (let attempt = 0; attempt < (mutation ? 1 : 3); attempt++) {
      this.budget.take(); // Failure here proves this attempt was not dispatched.
      try {
        if (mutation) this.budget.mutationDispatched = true;
        const response = await this.budget.run(
          this.fetcher(
            new Request(url, {
              method,
              redirect: 'manual',
              signal: this.budget.signal,
              headers: {
                'x-goog-api-key': this.key,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: body === undefined ? undefined : JSON.stringify(body),
            }),
          ),
        );
        if (!response.ok) {
          await response.body?.cancel().catch(() => {}); // Never expose Google's error body.
          if (
            mutation &&
            (response.status >= 500 ||
              response.status === 408 ||
              (response.status >= 300 && response.status < 400))
          )
            throw new GatewayError('UPSTREAM_OUTCOME_UNKNOWN', 502);
          if (!mutation && (response.status === 429 || response.status >= 500) && attempt < 2) {
            const delay = retryDelay(response.headers.get('retry-after'), attempt);
            if (delay < Math.min(2_000, this.budget.remainingMs - 250)) {
              await this.budget.sleep(delay);
              continue;
            }
          }
          const details = { upstreamStatus: response.status };
          if (response.status === 401) throw new GatewayError('UPSTREAM_AUTHENTICATION_FAILED', 502, details);
          if (response.status === 403) throw new GatewayError('UPSTREAM_FORBIDDEN', 403, details);
          if (response.status === 404) throw new GatewayError('RESOURCE_NOT_FOUND', 404, details);
          if (response.status === 410) throw new GatewayError('RESOURCE_EXPIRED', 410, details);
          if (response.status === 409 || response.status === 412)
            throw new GatewayError('INVALID_SESSION_STATE', 409, details);
          if (response.status === 429)
            throw new GatewayError('JULES_QUOTA_EXHAUSTED', 429, {
              ...details,
              retryAfterMs: retryDelay(response.headers.get('retry-after'), attempt),
            });
          throw new GatewayError(
            response.status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'UPSTREAM_REJECTED',
            502,
            details,
          );
        }
        const text = await readLimited(response, this.budget.limits.upstreamBytes, this.budget);
        if (!text && mutation) return {};
        let result: unknown;
        try {
          result = JSON.parse(text);
        } catch {
          throw new GatewayError('UPSTREAM_PROTOCOL_ERROR', 502);
        }
        requireThat(
          result && typeof result === 'object' && !Array.isArray(result),
          'UPSTREAM_PROTOCOL_ERROR',
          502,
        );
        return result as JsonObject;
      } catch (error) {
        if (mutation) {
          // Definitive 4xx rejections stay definitive. Every lost/malformed success is ambiguous.
          if (
            error instanceof GatewayError &&
            [
              'UPSTREAM_AUTHENTICATION_FAILED',
              'UPSTREAM_FORBIDDEN',
              'RESOURCE_NOT_FOUND',
              'RESOURCE_EXPIRED',
              'INVALID_SESSION_STATE',
              'JULES_QUOTA_EXHAUSTED',
              'UPSTREAM_REJECTED',
            ].includes(error.code)
          )
            throw error;
          throw new GatewayError('UPSTREAM_OUTCOME_UNKNOWN', 502);
        }
        if (error instanceof GatewayError) throw error;
        if (attempt < 2 && this.budget.remainingMs > 500) {
          await this.budget.sleep(retryDelay(null, attempt));
          continue;
        }
        throw new GatewayError(
          this.budget.signal.aborted ? 'DEADLINE_EXCEEDED' : 'UPSTREAM_UNAVAILABLE',
          502,
        );
      }
    }
    throw new GatewayError('UPSTREAM_UNAVAILABLE', 502);
  }
  private page<T extends JsonObject>(result: JsonObject, field: string): T {
    requireThat(result[field] === undefined || Array.isArray(result[field]), 'UPSTREAM_PROTOCOL_ERROR', 502);
    requireThat(
      result[field] === undefined ||
        (result[field] as unknown[]).every(
          (item) => item && typeof item === 'object' && !Array.isArray(item),
        ),
      'UPSTREAM_PROTOCOL_ERROR',
      502,
    );
    requireThat(
      result.nextPageToken === undefined ||
        (typeof result.nextPageToken === 'string' && result.nextPageToken.length <= 2_048),
      'UPSTREAM_PROTOCOL_ERROR',
      502,
    );
    return { ...result, [field]: result[field] ?? [] } as T;
  }
  async listSources(options: ListOptions & { filter?: string } = {}): Promise<SourcePage> {
    return this.page<SourcePage>(
      await this.request('GET', 'sources', undefined, { ...options, pageSize: options.pageSize ?? 20 }),
      'sources',
    );
  }
  async getSource(name: string): Promise<Source> {
    name = resourceName(name.startsWith('sources/') ? name : `sources/${name}`, 'source');
    const result = await this.request('GET', name);
    requireThat(result.name === name, 'UPSTREAM_PROTOCOL_ERROR', 502);
    return result as Source;
  }
  async createSession(body: CreateSession): Promise<Session> {
    const result = await this.request('POST', 'sessions', body);
    // A missing session identifier after a write is NOT safe to retry.
    try {
      resourceName(result.name as string, 'session');
    } catch {
      throw new GatewayError('UPSTREAM_OUTCOME_UNKNOWN', 502);
    }
    return result as Session;
  }
  async listSessions(options: ListOptions = {}): Promise<SessionPage> {
    return this.page<SessionPage>(
      await this.request('GET', 'sessions', undefined, { ...options, pageSize: options.pageSize ?? 20 }),
      'sessions',
    );
  }
  async getSession(name: string): Promise<Session> {
    const result = await this.request('GET', resourceName(name, 'session'));
    requireThat(result.name === name, 'UPSTREAM_PROTOCOL_ERROR', 502);
    return result as Session;
  }
  async deleteSession(name: string): Promise<JsonObject> {
    return this.request('DELETE', resourceName(name, 'session'));
  }
  async sendMessage(name: string, prompt: string): Promise<JsonObject> {
    return this.request('POST', `${resourceName(name, 'session')}:sendMessage`, { prompt });
  }
  async approvePlan(name: string): Promise<JsonObject> {
    return this.request('POST', `${resourceName(name, 'session')}:approvePlan`, {});
  }
  async listActivities(
    name: string,
    options: ListOptions & { createTime?: string } = {},
  ): Promise<ActivityPage> {
    return this.page<ActivityPage>(
      await this.request('GET', `${resourceName(name, 'session')}/activities`, undefined, {
        ...options,
        pageSize: options.pageSize ?? 20,
      }),
      'activities',
    );
  }
  async getActivity(name: string): Promise<Activity> {
    const result = await this.request('GET', resourceName(name, 'activity'));
    requireThat(result.name === name, 'UPSTREAM_PROTOCOL_ERROR', 502);
    return result as Activity;
  }
}
