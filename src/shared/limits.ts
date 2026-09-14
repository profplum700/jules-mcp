import { GatewayError } from './errors.ts';
export const DEFAULT_LIMITS = Object.freeze({
  deadlineMs: 20_000,
  maxRequests: 20,
  requestBytes: 65_536,
  upstreamBytes: 262_144,
  outputChars: 60_000,
  transportBytes: 524_288,
  resolverPages: 8,
  artifactChars: 20_000,
});
export type Limits = { -readonly [K in keyof typeof DEFAULT_LIMITS]: number };
/** One request-local budget, shared by auth persistence, login HTTP and Jules HTTP. */
export class RequestBudget {
  readonly limits: Limits;
  readonly started: number;
  readonly controller = new AbortController();
  calls = 0;
  mutationDispatched = false;
  private timer: ReturnType<typeof setTimeout>;
  constructor(limits: Partial<Limits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.started = Date.now();
    this.timer = setTimeout(() => this.controller.abort(), this.limits.deadlineMs);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  get remainingMs(): number {
    return this.limits.deadlineMs - (Date.now() - this.started);
  }
  check(): void {
    if (this.signal.aborted || this.remainingMs <= 0) throw new GatewayError('DEADLINE_EXCEEDED', 504);
  }
  take(): void {
    this.check();
    if (this.calls >= this.limits.maxRequests) throw new GatewayError('REQUEST_BUDGET_EXHAUSTED', 429);
    this.calls++;
  }
  async run<T>(operation: Promise<T>): Promise<T> {
    this.check();
    let rejectOnAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectOnAbort = () => reject(new GatewayError('DEADLINE_EXCEEDED', 504));
      this.signal.addEventListener('abort', rejectOnAbort, { once: true });
    });
    try {
      return await Promise.race([operation, aborted]);
    } finally {
      this.signal.removeEventListener('abort', rejectOnAbort);
    }
  }
  async sleep(ms: number): Promise<void> {
    this.check();
    if (ms >= this.remainingMs) throw new GatewayError('DEADLINE_EXCEEDED', 504);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.run(
        new Promise<void>((r) => {
          timer = setTimeout(r, ms);
        }),
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  close(): void {
    clearTimeout(this.timer);
    this.controller.abort();
  }
}
/** Bounded incremental read, including chunked bodies without Content-Length. */
export async function readLimited(
  message: Request | Response,
  maxBytes: number,
  budget: RequestBudget,
  code: 'REQUEST_TOO_LARGE' | 'UPSTREAM_TOO_LARGE' | 'OUTPUT_TOO_LARGE' = 'UPSTREAM_TOO_LARGE',
): Promise<string> {
  const length = message.headers.get('content-length');
  if (length && Number(length) > maxBytes) {
    await message.body?.cancel().catch(() => {});
    throw new GatewayError(code, code === 'REQUEST_TOO_LARGE' ? 413 : 502);
  }
  if (!message.body) return '';
  const reader = message.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      budget.check();
      const part = await budget.run(reader.read());
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw new GatewayError(code, code === 'REQUEST_TOO_LARGE' ? 413 : 502);
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
