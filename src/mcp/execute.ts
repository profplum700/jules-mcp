import { assertPrincipal, requireScope, type Principal } from '../auth/principal.ts';
import { JulesClient } from '../jules/client.ts';
import { resolveRepository } from '../jules/resolve-repository.ts';
import { normalizeRepository, resourceName, branchName } from '../jules/resources.ts';
import type { CreateSession, JsonObject } from '../jules/types.ts';
import { sha256 } from '../shared/crypto.ts';
import { GatewayError, requireThat, safeError } from '../shared/errors.ts';
import { safeLog } from '../observability/safe-log.ts';
import { TOOLS, type ToolDefinition } from './catalog.ts';
import { compact, toolResult } from './results.ts';
export const VERSION = '0.1.0-prototype';
export interface ToolContext {
  principal: Principal;
  jules: JulesClient;
  requestId: string;
  rateLimit?: (control: boolean, principal: Principal) => Promise<boolean>;
  log?: (event: Record<string, unknown>) => void;
}
export function validateArguments(tool: ToolDefinition, input: unknown): JsonObject {
  requireThat(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_ARGUMENT');
  const args = input as JsonObject;
  requireThat(
    Object.keys(args).every((key) => Object.hasOwn(tool.fields, key)),
    'INVALID_ARGUMENT',
  );
  for (const [key, field] of Object.entries(tool.fields)) {
    const value = args[key];
    if (value === undefined) {
      requireThat(!field.required, 'INVALID_ARGUMENT');
      continue;
    }
    if (field.type === 'string') {
      requireThat(
        typeof value === 'string' &&
          value.length >= (field.min ?? 0) &&
          value.length <= (field.max ?? 100000),
        'INVALID_ARGUMENT',
      );
      requireThat(!field.enum || field.enum.includes(value), 'INVALID_ARGUMENT');
    } else if (field.type === 'integer')
      requireThat(
        Number.isSafeInteger(value) &&
          Number(value) >= (field.min ?? 0) &&
          Number(value) <= (field.max ?? Number.MAX_SAFE_INTEGER),
        'INVALID_ARGUMENT',
      );
    else requireThat(typeof value === 'boolean', 'INVALID_ARGUMENT');
  }
  return args;
}
function list(page: JsonObject, field: string, detail: unknown, fields: string[], detailTool: string) {
  const items = page[field] as JsonObject[];
  requireThat(
    items.every((item) => item && typeof item === 'object' && !Array.isArray(item)),
    'UPSTREAM_PROTOCOL_ERROR',
    502,
  );
  return {
    [field]: detail ? items : items.map((item) => compact(item, fields, detailTool)),
    nextPageToken: page.nextPageToken ?? null,
    complete: !page.nextPageToken,
    mode: detail ? 'detail' : 'metadata',
  };
}
async function run(name: string, args: JsonObject, ctx: ToolContext): Promise<JsonObject> {
  const j = ctx.jules;
  const pagination = {
    pageSize: args.pageSize as number | undefined,
    pageToken: args.pageToken as string | undefined,
  };
  switch (name) {
    case 'jules_gateway_info':
      return {
        version: VERSION,
        principal: ctx.principal,
        tools: TOOLS.map((t) => t.name),
        limits: j.budget.limits,
        supervision: 'none',
        repositoryPolicy: 'all Jules-connected sources',
        independentCredentialsNotTenantIsolation: true,
      };
    case 'jules_list_sources':
      return list(
        await j.listSources({ ...pagination, filter: args.filter as string | undefined }),
        'sources',
        args.detail,
        ['name', 'id', 'githubRepo'],
        'jules_get_source',
      );
    case 'jules_get_source':
      return j.getSource(args.source as string);
    case 'jules_resolve_repository':
      return {
        ...(await resolveRepository(j, args.repository as string, {
          branch: args.branch as string | undefined,
          pageToken: args.pageToken as string | undefined,
        })),
      };
    case 'jules_create_session': {
      requireThat(
        [args.repository !== undefined, args.source !== undefined, args.repositoryless === true].filter(
          Boolean,
        ).length === 1,
        'INVALID_ARGUMENT',
      );
      requireThat(args.repositoryless === undefined || args.repositoryless === true, 'INVALID_ARGUMENT');
      const body: CreateSession = { prompt: args.prompt as string };
      if (args.title !== undefined) body.title = args.title as string;
      if (args.requirePlanApproval !== undefined)
        body.requirePlanApproval = args.requirePlanApproval as boolean;
      if (args.automationMode !== undefined) body.automationMode = 'AUTO_CREATE_PR';
      let resolution: unknown;
      if (args.repositoryless)
        requireThat(args.branch === undefined && args.automationMode === undefined, 'INVALID_ARGUMENT');
      else {
        const input =
          args.source !== undefined
            ? resourceName(
                (args.source as string).startsWith('sources/')
                  ? (args.source as string)
                  : `sources/${args.source}`,
                'source',
              )
            : normalizeRepository(args.repository as string);
        const resolved = await resolveRepository(j, input, {
          branch: args.branch === undefined ? undefined : branchName(args.branch as string),
        });
        body.sourceContext = {
          source: resolved.source,
          githubRepoContext: { startingBranch: resolved.branch },
        };
        resolution = resolved;
      }
      return {
        ...(await j.createSession(body)),
        resolution: resolution ?? { repositoryless: true },
        upstreamOutcome: 'succeeded',
      };
    }
    case 'jules_list_sessions':
      return list(
        await j.listSessions(pagination),
        'sessions',
        args.detail,
        ['name', 'id', 'title', 'state', 'createTime', 'updateTime', 'outputs'],
        'jules_get_session',
      );
    case 'jules_get_session':
      return j.getSession(resourceName(args.session as string, 'session'));
    case 'jules_delete_session':
      await j.deleteSession(resourceName(args.session as string, 'session'));
      return {
        session: args.session,
        deleted: true,
        upstreamOutcome: 'succeeded',
        cancellationSemantics: 'not asserted',
      };
    case 'jules_send_message':
      await j.sendMessage(resourceName(args.session as string, 'session'), args.prompt as string);
      return { session: args.session, sent: true, upstreamOutcome: 'succeeded' };
    case 'jules_approve_plan':
      await j.approvePlan(resourceName(args.session as string, 'session'));
      return { session: args.session, approved: true, upstreamOutcome: 'succeeded' };
    case 'jules_list_activities': {
      if (args.createTime !== undefined)
        requireThat(
          /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(args.createTime as string) &&
            Number.isFinite(Date.parse(args.createTime as string)),
          'INVALID_ARGUMENT',
        );
      return list(
        await j.listActivities(resourceName(args.session as string, 'session'), {
          ...pagination,
          createTime: args.createTime as string | undefined,
        }),
        'activities',
        args.detail,
        ['name', 'id', 'originator', 'createTime', 'description'],
        'jules_get_activity',
      );
    }
    case 'jules_get_activity':
      return j.getActivity(resourceName(args.activity as string, 'activity'));
    case 'jules_get_change_set': {
      const event = await j.getActivity(resourceName(args.activity as string, 'activity'));
      const artifacts = event.artifacts;
      requireThat(Array.isArray(artifacts), 'ARTIFACT_NOT_FOUND', 404);
      const changeSet = artifacts[args.artifactIndex as number]?.changeSet as JsonObject | undefined;
      const patch = changeSet?.gitPatch as JsonObject | undefined;
      requireThat(patch && typeof patch.unidiffPatch === 'string', 'ARTIFACT_NOT_FOUND', 404);
      const text = patch.unidiffPatch;
      const digest = await sha256(text);
      requireThat(
        args.expectedSha256 === undefined || args.expectedSha256 === digest,
        'ARTIFACT_CHANGED',
        409,
      );
      const start = Number(args.offset ?? 0);
      let end = Math.min(start + Number(args.limit ?? j.budget.limits.artifactChars), text.length);
      requireThat(start <= text.length, 'INVALID_ARGUMENT');
      // Never split UTF-16 surrogate pairs. Offsets always refer to the complete original string.
      requireThat(
        !(start > 0 && /[\uDC00-\uDFFF]/.test(text[start] ?? '') && /[\uD800-\uDBFF]/.test(text[start - 1])),
        'INVALID_ARGUMENT',
      );
      if (
        end < text.length &&
        /[\uD800-\uDBFF]/.test(text[end - 1] ?? '') &&
        /[\uDC00-\uDFFF]/.test(text[end])
      )
        end--;
      requireThat(end > start || start === text.length, 'INVALID_ARGUMENT');
      return {
        session: (args.activity as string).split('/').slice(0, 2).join('/'),
        activity: args.activity,
        artifactIndex: args.artifactIndex,
        source: changeSet?.source,
        baseCommitId: patch.baseCommitId,
        suggestedCommitMessage: patch.suggestedCommitMessage,
        patch: text.slice(start, end),
        sha256: digest,
        offset: start,
        totalChars: text.length,
        returnedChars: end - start,
        truncated: end < text.length || start > 0,
        nextOffset: end < text.length ? end : null,
        offsetUnit: 'UTF-16 code units',
      };
    }
    default:
      throw new GatewayError('INVALID_ARGUMENT');
  }
}
export async function executeTool(name: string, input: unknown, ctx: ToolContext) {
  const started = Date.now();
  let category = 'OK';
  try {
    const tool = TOOLS.find((t) => t.name === name);
    requireThat(tool, 'INVALID_ARGUMENT');
    const principal = assertPrincipal(ctx.principal);
    requireScope(principal, tool.control ? 'jules:control' : 'jules:read');
    const args = validateArguments(tool, input);
    if (ctx.rateLimit) requireThat(await ctx.rateLimit(tool.control, principal), 'GATEWAY_RATE_LIMITED', 429);
    const data = await run(name, args, { ...ctx, principal });
    return toolResult(
      data,
      tool.control
        ? 'Jules accepted the action. Inspect upstream state before deciding on any further action.'
        : 'Requested Jules data returned; check completeness, omittedFields and continuation information.',
      ctx.jules.budget.limits.outputChars,
      tool.control,
    );
  } catch (error) {
    const e = safeError(error);
    category = e.code;
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `${e.code}: ${e.message}` }],
      structuredContent: { error: { code: e.code, message: e.message, ...e.details } },
    };
  } finally {
    (ctx.log ?? safeLog)({
      requestId: ctx.requestId,
      clientId: ctx.principal.clientId,
      tool: name,
      category,
      durationMs: Date.now() - started,
    });
  }
}
