import { messages } from '../shared/errors.ts';
/** A whitelist, not a best-effort regex scrubber of arbitrary logs. */
export function safeLogEvent(input: Record<string, unknown>): Record<string, string | number> {
  const event: Record<string, string | number> = {};
  if (typeof input.requestId === 'string' && /^[a-f0-9-]{36}$/.test(input.requestId))
    event.requestId = input.requestId;
  if (typeof input.clientId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(input.clientId))
    event.clientId = input.clientId;
  if (typeof input.tool === 'string' && /^jules_[a-z_]{1,40}$/.test(input.tool)) event.tool = input.tool;
  if (
    input.category === 'OK' ||
    (typeof input.category === 'string' && Object.hasOwn(messages, input.category))
  )
    event.category = input.category as string;
  for (const key of ['durationMs', 'upstreamStatus'])
    if (typeof input[key] === 'number' && Number.isFinite(input[key]))
      event[key] = Math.max(0, Math.floor(input[key] as number));
  return event;
}
export function safeLog(input: Record<string, unknown>): void {
  console.log(JSON.stringify(safeLogEvent(input)));
}
