/** Narrow known fields, forward-compatible unknown states and response fields. */
export type JsonObject = Record<string, unknown>;
export interface Source extends JsonObject {
  name: string;
  githubRepo?: {
    owner: string;
    repo: string;
    isPrivate?: boolean;
    defaultBranch?: { displayName?: string };
    branches?: Array<{ displayName?: string }>;
    [key: string]: unknown;
  };
}
export interface Page extends JsonObject {
  nextPageToken?: string;
}
export interface SourcePage extends Page {
  sources: Source[];
}
export interface Session extends JsonObject {
  name: string;
  state?: string;
}
export interface SessionPage extends Page {
  sessions: Session[];
}
export interface Activity extends JsonObject {
  name: string;
  artifacts?: JsonObject[];
}
export interface ActivityPage extends Page {
  activities: Activity[];
}
export interface ListOptions {
  pageSize?: number;
  pageToken?: string;
}
export interface CreateSession {
  prompt: string;
  title?: string;
  requirePlanApproval?: boolean;
  automationMode?: 'AUTO_CREATE_PR' | 'AUTOMATION_MODE_UNSPECIFIED';
  sourceContext?: { source: string; githubRepoContext: { startingBranch: string } };
}
