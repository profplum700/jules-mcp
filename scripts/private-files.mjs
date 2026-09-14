import { mkdir, open, chmod, rename } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
export function privatePath(value) {
  const root = resolve('.private');
  const path = resolve(value);
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Secret files must be inside .private/.');
  return path;
}
export async function writePrivate(path, contents, replace = false) {
  path = privatePath(path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const target = replace ? `${path}.new-${process.pid}` : path;
  const handle = await open(target, 'wx', 0o600);
  try {
    await handle.writeFile(contents);
  } finally {
    await handle.close();
  }
  if (replace) await rename(target, path);
  await chmod(path, 0o600);
}
