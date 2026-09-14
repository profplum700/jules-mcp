import { GatewayError } from '../shared/errors.ts';
export function toolResult(
  data: Record<string, unknown>,
  summary: string,
  maxChars: number,
  mutation = false,
) {
  const size = JSON.stringify(data).length;
  if (size > maxChars) {
    if (mutation) {
      // A valid upstream success is NOT an unknown outcome merely because its payload is large.
      data = {
        success: true,
        upstreamOutcome: 'succeeded',
        name: data.name,
        outputOmitted: true,
        totalChars: size,
        nextTool: 'jules_get_session',
      };
      summary =
        'The mutation succeeded; oversized result content was omitted. Inspect the returned session; do not repeat the mutation.';
    } else
      throw new GatewayError('OUTPUT_TOO_LARGE', 413, {
        totalChars: size,
        maxChars,
        guidance:
          'Use metadata mode, a smaller page, or jules_get_change_set with explicit activity and artifact index.',
      });
  }
  return { content: [{ type: 'text' as const, text: summary }], structuredContent: data };
}
export function compact(item: Record<string, unknown>, fields: string[], detailTool: string) {
  const data = Object.fromEntries(
    fields.filter((key) => item[key] !== undefined).map((key) => [key, item[key]]),
  );
  if (data.githubRepo && typeof data.githubRepo === 'object') {
    const repo = data.githubRepo as Record<string, unknown>;
    const keys = ['owner', 'repo', 'isPrivate', 'defaultBranch'];
    data.githubRepo = Object.fromEntries(
      keys.filter((key) => repo[key] !== undefined).map((key) => [key, repo[key]]),
    );
    data.githubRepoOmittedFields = Object.keys(repo).filter((key) => !keys.includes(key));
  }
  return { ...data, omittedFields: Object.keys(item).filter((key) => !fields.includes(key)), detailTool };
}
