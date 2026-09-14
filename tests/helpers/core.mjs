import { JulesClient } from '../../src/jules/client.ts';
import { RequestBudget } from '../../src/shared/limits.ts';
export const source = (
  name = 'sources/opaque-source',
  owner = 'acme',
  repo = 'widgets',
  branch = 'develop',
) => ({
  name,
  id: name.split('/')[1],
  githubRepo: { owner, repo, defaultBranch: { displayName: branch }, branches: [{ displayName: branch }] },
});
export const session = (extra = {}) => ({
  name: 'sessions/test-session',
  state: 'FUTURE_STATE',
  outputs: [{ pullRequest: { url: 'https://github.com/acme/widgets/pull/1' } }],
  ...extra,
});
export const event = (patch = 'diff --git a/a b/a\n+hello\n') => ({
  name: 'sessions/test-session/activities/test-activity',
  artifacts: [
    {
      changeSet: {
        source: 'sources/opaque-source',
        gitPatch: { baseCommitId: 'abc123', unidiffPatch: patch, suggestedCommitMessage: 'Example change' },
      },
    },
  ],
});
export const principal = (id = 'client-a', scopes = ['jules:read', 'jules:control']) => ({
  clientId: id,
  credentialId: id,
  authMethod: 'service-token',
  scopes,
});
export function mockClient(responses = [], limits = {}) {
  const calls = [];
  const budget = new RequestBudget(limits);
  const client = new JulesClient('synthetic-upstream-value', budget, async (request) => {
    calls.push({
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: request.body ? await request.json() : undefined,
    });
    if (!responses.length) throw new Error('Unexpected mocked request');
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (typeof response === 'function') return response(request);
    return response instanceof Response ? response : Response.json(response);
  });
  return { client, calls, budget, close: () => budget.close() };
}
export function context(client, p = principal(), extra = {}) {
  return {
    principal: p,
    jules: client,
    requestId: '00000000-0000-4000-8000-000000000000',
    log: () => {},
    ...extra,
  };
}
export const rejectsCode = (code) => (error) => error?.code === code;
