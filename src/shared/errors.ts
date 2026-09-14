/** Public errors are deliberately finite: never serialize arbitrary caught errors. */
export const messages = {
  INVALID_ARGUMENT: 'Invalid arguments. Check the tool schema and context requirements.',
  UNAUTHENTICATED: 'A valid client credential is required.',
  FORBIDDEN: 'This credential does not have the required permission.',
  CONFIGURATION_ERROR: 'Gateway security configuration is missing or invalid. Contact the deployment owner.',
  GATEWAY_DISABLED: 'The deployment owner has disabled this gateway.',
  GATEWAY_RATE_LIMITED: 'Gateway rate limit reached. Wait before trying again.',
  REQUEST_TOO_LARGE: 'Request exceeds the gateway input limit.',
  OUTPUT_TOO_LARGE:
    'Response exceeds the gateway limit. Request a smaller page, metadata view, or selected artifact slice.',
  UPSTREAM_TOO_LARGE:
    'Upstream response exceeds the gateway read limit. Reduce page size; this gateway cannot stream an unbounded artifact.',
  UPSTREAM_AUTHENTICATION_FAILED:
    'Google rejected the gateway Jules credential. Contact the deployment owner.',
  UPSTREAM_FORBIDDEN: 'Jules denied this operation for the connected account.',
  JULES_QUOTA_EXHAUSTED: 'Jules returned a quota/rate-limit response. Check the account before retrying.',
  RESOURCE_NOT_FOUND: 'Jules could not find this resource. It may have been removed or disconnected.',
  RESOURCE_EXPIRED: 'The upstream resource is no longer available.',
  INVALID_SESSION_STATE: 'Jules rejected this action in the current session state. Inspect the session.',
  UPSTREAM_REJECTED: 'Jules rejected this request. Inspect the arguments and current session.',
  UPSTREAM_UNAVAILABLE: 'Jules is temporarily unavailable. Read operations may be retried later.',
  UPSTREAM_PROTOCOL_ERROR: 'The upstream response did not match the supported API contract.',
  UPSTREAM_OUTCOME_UNKNOWN:
    'A mutation may have succeeded. Inspect Jules sessions/activities before deciding whether to repeat it. No automatic retry was made.',
  DEADLINE_EXCEEDED: 'The gateway request deadline was reached.',
  REQUEST_BUDGET_EXHAUSTED: 'The gateway request budget was exhausted.',
  REPOSITORY_NOT_CONNECTED: 'No matching repository was found in a complete scan of connected Jules sources.',
  RESOLUTION_INCOMPLETE:
    'Repository scan is incomplete. Continue listing/resolving sources, then pass a verified canonical source.',
  REPOSITORY_AMBIGUOUS:
    'Multiple canonical sources match this repository. Choose a canonical source explicitly.',
  BRANCH_REQUIRED: 'Jules did not report a usable default branch. Supply the branch explicitly.',
  ARTIFACT_NOT_FOUND: 'The selected activity artifact is not a change set.',
  ARTIFACT_CHANGED: 'The artifact changed. Restart pagination using the new artifact digest.',
  OAUTH_INVALID_REQUEST: 'The authorization request is invalid or has expired. Start a new connection.',
  OWNER_DENIED: 'Only the configured deployment owner may authorize clients.',
  INTERNAL_ERROR: 'The gateway could not complete this request.',
} as const;
export type ErrorCode = keyof typeof messages;
export class GatewayError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;
  constructor(code: ErrorCode, status = 400, details: Record<string, unknown> = {}) {
    super(messages[code]);
    this.name = 'GatewayError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
export function safeError(error: unknown): GatewayError {
  return error instanceof GatewayError ? error : new GatewayError('INTERNAL_ERROR', 500);
}
export function requireThat(
  value: unknown,
  code: ErrorCode = 'INVALID_ARGUMENT',
  status = 400,
): asserts value {
  if (!value) throw new GatewayError(code, status);
}
