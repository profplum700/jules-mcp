import { requireThat } from '../shared/errors.ts';
const identifier = /^[A-Za-z0-9_~.-]{1,256}$/;
export function resourceName(value: string, kind: 'source' | 'session' | 'activity'): string {
  requireThat(typeof value === 'string' && value.length <= 768);
  const p = value.split('/');
  const valid =
    kind === 'source'
      ? p[0] === 'sources' && (p.length === 2 || (p.length === 4 && p[1] === 'github'))
      : kind === 'session'
        ? p.length === 2 && p[0] === 'sessions'
        : p.length === 4 && p[0] === 'sessions' && p[2] === 'activities';
  requireThat(valid);
  for (const part of kind === 'activity' ? [p[1], p[3]] : kind === 'source' ? p.slice(1) : [p[1]]) {
    requireThat(identifier.test(part!) && part !== '.' && part !== '..');
  }
  return value;
}
export function branchName(branch: string): string {
  requireThat(
    typeof branch === 'string' &&
      branch.length > 0 &&
      branch.length <= 255 &&
      !/[\x00-\x20\x7f]/.test(branch),
  );
  return branch;
}
export function normalizeRepository(input: string): string {
  requireThat(typeof input === 'string' && input.length <= 512 && input === input.trim());
  let value = input;
  if (input.startsWith('https://')) {
    const u = new URL(input);
    requireThat(u.origin === 'https://github.com' && !u.username && !u.password && !u.search && !u.hash);
    // Reject encodings and dot-segment normalization before trusting URL.pathname.
    requireThat(!/%|\\/.test(input));
    value = u.pathname
      .slice(1)
      .replace(/\/$/, '')
      .replace(/\.git$/, '');
    requireThat(input.replace(/\/$/, '').replace(/\.git$/, '') === `https://github.com/${value}`);
  }
  requireThat(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(value));
  const repo = value.split('/')[1];
  requireThat(repo !== '.' && repo !== '..');
  return value.toLowerCase();
}
