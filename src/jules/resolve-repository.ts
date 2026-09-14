import { GatewayError, requireThat } from '../shared/errors.ts';
import { branchName, normalizeRepository, resourceName } from './resources.ts';
import type { JulesClient } from './client.ts';
import type { Source } from './types.ts';
export interface Resolution {
  source: string;
  repository: string | null;
  branch: string;
  complete: boolean;
  pagesScanned: number;
}
export async function resolveRepository(
  client: JulesClient,
  input: string,
  options: { branch?: string; pageToken?: string; maxPages?: number } = {},
): Promise<Resolution> {
  if (options.branch !== undefined) branchName(options.branch);
  let source: Source | undefined;
  let pagesScanned = 0;
  let complete = !options.pageToken;
  // Opaque bare IDs are source identifiers only, never repository-name guesses.
  if (!input.includes('/') || input.startsWith('github/')) input = `sources/${input}`;
  if (input.startsWith('sources/')) {
    requireThat(!options.pageToken);
    source = await client.getSource(resourceName(input, 'source'));
  } else {
    const repository = normalizeRepository(input);
    let token = options.pageToken;
    const seenTokens = new Set<string>();
    const matches = new Map<string, Source>();
    const maxPages = options.maxPages ?? client.budget.limits.resolverPages;
    requireThat(Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= 8);
    do {
      if (pagesScanned >= maxPages || client.budget.calls >= client.budget.limits.maxRequests - 2) {
        throw new GatewayError('RESOLUTION_INCOMPLETE', 409, {
          repository,
          nextPageToken: token,
          pagesScanned,
          candidates: [...matches.keys()],
          complete: false,
        });
      }
      if (token) {
        requireThat(!seenTokens.has(token), 'UPSTREAM_PROTOCOL_ERROR', 502);
        seenTokens.add(token);
      }
      const page = await client.listSources({ pageSize: 100, pageToken: token });
      pagesScanned++;
      for (const item of page.sources) {
        const repo = item.githubRepo;
        if (
          repo &&
          typeof repo.owner === 'string' &&
          typeof repo.repo === 'string' &&
          `${repo.owner}/${repo.repo}`.toLowerCase() === repository
        ) {
          resourceName(item.name, 'source');
          matches.set(item.name, item);
        }
      }
      token = page.nextPageToken || undefined;
    } while (token);
    if (matches.size > 1)
      throw new GatewayError('REPOSITORY_AMBIGUOUS', 409, { candidates: [...matches.keys()], pagesScanned });
    if (!complete) {
      // A caller-provided cursor cannot prove uniqueness in pages we did not inspect.
      throw new GatewayError('RESOLUTION_INCOMPLETE', 409, {
        repository,
        nextPageToken: null,
        pagesScanned,
        candidates: [...matches.keys()],
        complete: false,
        scannedRemainder: true,
      });
    }
    if (!matches.size)
      throw new GatewayError('REPOSITORY_NOT_CONNECTED', 404, { repository, pagesScanned, complete: true });
    source = [...matches.values()][0];
    if (!source?.githubRepo?.defaultBranch?.displayName && !options.branch)
      source = await client.getSource(source!.name);
  }
  requireThat(source, 'UPSTREAM_PROTOCOL_ERROR', 502);
  const branch = options.branch ?? source.githubRepo?.defaultBranch?.displayName;
  if (!branch) throw new GatewayError('BRANCH_REQUIRED', 409, { source: source.name });
  branchName(branch);
  return {
    source: source.name,
    repository: source.githubRepo
      ? `${source.githubRepo.owner}/${source.githubRepo.repo}`.toLowerCase()
      : null,
    branch,
    complete,
    pagesScanned,
  };
}
