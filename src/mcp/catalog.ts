export type Field = {
  type: 'string' | 'integer' | 'boolean';
  description: string;
  required?: boolean;
  min?: number;
  max?: number;
  enum?: string[];
};
export type ToolDefinition = {
  name: string;
  description: string;
  control: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  fields: Record<string, Field>;
};
const string = (description: string, max = 512, required = false): Field => ({
  type: 'string',
  description,
  max,
  min: 1,
  required,
});
const session = {
  session: string(
    'Canonical sessions/ID returned by Jules; not an MCP transport session identifier.',
    300,
    true,
  ),
};
const activity = {
  activity: string('Exact sessions/ID/activities/ID from jules_list_activities.', 768, true),
};
const pagination = {
  pageSize: {
    type: 'integer',
    description: 'One bounded page; default 20. Follow nextPageToken explicitly.',
    min: 1,
    max: 100,
  } as Field,
  pageToken: string('Opaque continuation token from this same list operation; do not edit it.', 2048),
};
const mode = {
  detail: {
    type: 'boolean',
    description:
      'Default false returns metadata with explicit omitted fields. True returns a bounded full page; use detail tools for large items.',
  } as Field,
};
export const TOOLS: ToolDefinition[] = [
  {
    name: 'jules_list_sources',
    control: false,
    description:
      'List repositories currently connected to this Jules account. No gateway repository allowlist. Returns one page and explicit continuation.',
    fields: {
      ...pagination,
      filter: string(
        'Documented Jules source filter (AIP-160). Passed as a query parameter, never as a URL.',
        1024,
      ),
      ...mode,
    },
  },
  {
    name: 'jules_get_source',
    control: false,
    description:
      'Read one canonical source, including the actual default branch and available repository metadata.',
    fields: {
      source: string(
        'Exact sources/ID name or opaque source ID from Jules; nested github/owner/repo IDs are accepted.',
        300,
        true,
      ),
    },
  },
  {
    name: 'jules_resolve_repository',
    control: false,
    description:
      'Resolve exact owner/repo, exact HTTPS GitHub repository URL, or canonical source. No fuzzy matching. Scans bounded pages for ambiguity; incomplete results require continuation or explicit canonical selection. Uses reported default branch, never assumes main.',
    fields: {
      repository: string(
        'owner/repo, exact GitHub HTTPS repository URL, canonical sources/ID, or opaque Jules source ID. Bare input is a source ID only, never a repository-name guess.',
        512,
        true,
      ),
      branch: string('Explicit case-sensitive branch; preserved exactly.', 255),
      pageToken: pagination.pageToken,
    },
  },
  {
    name: 'jules_create_session',
    control: true,
    description:
      'Start a Jules coding task. Select exactly one of repository, source, or repositoryless=true. Resolves the reported default branch when branch is omitted. Approval defaults are upstream defaults. AUTO_CREATE_PR creates a PR, never merges it. Do not repeat after UPSTREAM_OUTCOME_UNKNOWN; inspect sessions first.',
    fields: {
      prompt: string('Task instructions. Treated as user content, never operational logs.', 30000, true),
      repository: string('Exact owner/repo or exact HTTPS GitHub repository URL; never a fuzzy name.'),
      source: string('Exact sources/ID name or opaque source ID returned by Jules.', 300),
      repositoryless: {
        type: 'boolean',
        description: 'Explicit true intentionally creates a task without repository context.',
      },
      branch: string('Case-sensitive branch. Requires repository/source. Omit to use reported default.', 255),
      title: string('Optional upstream session title.', 512),
      requirePlanApproval: {
        type: 'boolean',
        description:
          'True requests Jules plan approval; omission preserves Jules automatic-approval default. No gateway approval queue.',
      },
      automationMode: {
        type: 'string',
        description: 'Optional documented automatic PR creation, not merging.',
        enum: ['AUTO_CREATE_PR'],
      },
    },
  },
  {
    name: 'jules_list_sessions',
    control: false,
    description:
      'List this Jules account’s sessions, including sessions created through other authorised clients. One page; follow nextPageToken. No undocumented session filter.',
    fields: { ...pagination, ...mode },
  },
  {
    name: 'jules_get_session',
    control: false,
    description:
      'Read state, metadata, task content and available outputs, including PR information. Unknown future Jules states are preserved.',
    fields: session,
  },
  {
    name: 'jules_delete_session',
    control: true,
    destructive: true,
    idempotent: true,
    description:
      'Delete the specified Jules session using the documented DELETE operation. Destructive. Deletion is not a documented cancellation promise. No automatic retry after an ambiguous result.',
    fields: session,
  },
  {
    name: 'jules_send_message',
    control: true,
    description:
      'Send instructions or feedback to a session created by any authorised client. Mutates upstream state; a lost response must not be blindly repeated.',
    fields: { ...session, prompt: string('Message for Jules.', 30000, true) },
  },
  {
    name: 'jules_approve_plan',
    control: true,
    description:
      'Approve a pending Jules plan directly. Jules may reject an invalid session state. No gateway human confirmation queue; host confirmations still apply.',
    fields: session,
  },
  {
    name: 'jules_list_activities',
    control: false,
    description:
      'Read one page of session events. Metadata mode omits artifact content; fetch a selected event or change set explicitly. No background polling.',
    fields: {
      ...session,
      ...pagination,
      ...mode,
      createTime: string(
        'Optional createTime timestamp shown in the official activity-list example; upstream support is experimental.',
        64,
      ),
    },
  },
  {
    name: 'jules_get_activity',
    control: false,
    description:
      'Read an exact event and artifacts, subject to explicit output limits. For large patches use jules_get_change_set instead.',
    fields: activity,
  },
  {
    name: 'jules_get_change_set',
    control: false,
    description:
      'Read a selected activity’s change-set artifact. Derived from activities.get, not a separate Jules diff API. Returns bounded patch text, base commit, digest, total length and next offset. No guessed latest-event scan.',
    fields: {
      ...activity,
      artifactIndex: {
        type: 'integer',
        description: 'Zero-based artifact index in the selected activity.',
        min: 0,
        max: 999,
        required: true,
      },
      offset: {
        type: 'integer',
        description: 'UTF-16 character offset from previous nextOffset; default zero.',
        min: 0,
        max: 10000000,
      },
      limit: { type: 'integer', description: 'Maximum patch characters, default 20000.', min: 1, max: 40000 },
      expectedSha256: string('Optional prior patch digest. Rejects continuation if the patch changed.', 64),
    },
  },
  {
    name: 'jules_gateway_info',
    control: false,
    description:
      'Read gateway version, tool capabilities, limits, and this verified credential’s own identity/scopes. Does not reveal owner, secrets, other clients or infrastructure.',
    fields: {},
  },
];
export function toolSchema(tool: ToolDefinition) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      Object.entries(tool.fields).map(([name, field]) => [
        name,
        {
          type: field.type,
          description: field.description,
          ...(field.enum ? { enum: field.enum } : {}),
          ...(field.min !== undefined
            ? { [field.type === 'string' ? 'minLength' : 'minimum']: field.min }
            : {}),
          ...(field.max !== undefined
            ? { [field.type === 'string' ? 'maxLength' : 'maximum']: field.max }
            : {}),
        },
      ]),
    ),
    required: Object.entries(tool.fields)
      .filter(([, f]) => f.required)
      .map(([name]) => name),
  };
}
