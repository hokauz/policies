import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

function isWithinRoot(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

function resolveWithinRoot(repoRoot: string, ...parts: string[]): string {
  const lexicalRoot = resolve(repoRoot);
  const candidate = resolve(lexicalRoot, ...parts);

  if (!isWithinRoot(lexicalRoot, candidate)) {
    throw new Error(`Path escapes repository root: ${parts.join('/')}`);
  }

  const root = realpathSync(repoRoot);
  if (existsSync(candidate)) {
    const realCandidate = realpathSync(candidate);
    if (!isWithinRoot(root, realCandidate)) {
      throw new Error(`Path resolves outside repository root: ${parts.join('/')}`);
    }
  }

  return candidate;
}

export { isWithinRoot, resolveWithinRoot };
