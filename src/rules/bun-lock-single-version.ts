import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PolicyModuleCheckEntry, RootLockfileRule, RootPolicies } from '../types';
import { resolveWithinRoot } from '../path-safety';

interface BunLockPackageVersions {
  packageName: string;
  versions: Map<string, number>;
  line: number;
}

const PACKAGE_ENTRY_PATTERN = /^\s{4}"([^"]+)": \["([^"]+)"/;
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

function splitBunLockPackageIdentifier(identifier: string): { packageName: string; version: string } | null {
  const atIndex = identifier.lastIndexOf('@');

  if (atIndex <= 0 || atIndex === identifier.length - 1) {
    return null;
  }

  return {
    packageName: identifier.slice(0, atIndex),
    version: identifier.slice(atIndex + 1),
  };
}

function isTopLevelLockfilePackageKey(key: string): boolean {
  if (!key.includes('/')) {
    return true;
  }

  if (!key.startsWith('@')) {
    return false;
  }

  return key.split('/').length === 2;
}

function collectPackageVersions(lockfileText: string): BunLockPackageVersions[] {
  const packageVersions = new Map<string, BunLockPackageVersions>();
  const lines = lockfileText.split('\n');
  let inPackagesSection = false;

  for (const [index, line] of lines.entries()) {
    if (line === '  "packages": {') {
      inPackagesSection = true;
      continue;
    }

    if (inPackagesSection && line === '  },') {
      break;
    }

    if (!inPackagesSection) {
      continue;
    }

    const match = line.match(PACKAGE_ENTRY_PATTERN);

    if (!match) {
      continue;
    }

    const packageKey = match[1];
    if (!isTopLevelLockfilePackageKey(packageKey)) {
      continue;
    }

    const identifier = match[2];
    const parsed = splitBunLockPackageIdentifier(identifier);

    if (!parsed) {
      continue;
    }

    const existing = packageVersions.get(parsed.packageName);

    if (!existing) {
      packageVersions.set(parsed.packageName, {
        packageName: parsed.packageName,
        versions: new Map([[parsed.version, index + 1]]),
        line: index + 1,
      });
      continue;
    }

    existing.versions.set(parsed.version, index + 1);
    existing.line = Math.min(existing.line, index + 1);
  }

  return [...packageVersions.values()].filter((entry) => entry.versions.size > 1);
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

async function collectWorkspacePackageJsonPaths(repoRoot: string): Promise<string[]> {
  const rootPackageJsonPath = resolve(repoRoot, 'package.json');
  const rootPackageJson = readJsonFile<{ workspaces?: string[] }>(rootPackageJsonPath);
  const packageJsonPaths = new Set<string>([rootPackageJsonPath]);

  for (const workspacePattern of rootPackageJson?.workspaces ?? []) {
    const glob = new Bun.Glob(`${workspacePattern}/package.json`);

    for await (const match of glob.scan({
      cwd: repoRoot,
      absolute: true,
      onlyFiles: true,
    })) {
      packageJsonPaths.add(resolveWithinRoot(repoRoot, match));
    }
  }

  return [...packageJsonPaths].sort((left, right) => left.localeCompare(right));
}

async function collectDirectDependencyNames(repoRoot: string): Promise<Set<string>> {
  const dependencyNames = new Set<string>();

  for (const packageJsonPath of await collectWorkspacePackageJsonPaths(repoRoot)) {
    const packageJson = readJsonFile<Record<string, unknown>>(packageJsonPath);

    if (!packageJson) {
      continue;
    }

    for (const section of DEPENDENCY_SECTIONS) {
      const dependencies = packageJson[section];

      if (!dependencies || typeof dependencies !== 'object') {
        continue;
      }

      for (const dependencyName of Object.keys(dependencies)) {
        dependencyNames.add(dependencyName);
      }
    }
  }

  return dependencyNames;
}

async function checkRootLockfileRule(
  repoRoot: string,
  root: RootPolicies,
  rule: RootLockfileRule,
): Promise<PolicyModuleCheckEntry[]> {
  const absoluteLockfilePath = resolveWithinRoot(repoRoot, rule.lockfilePath);

  if (!existsSync(absoluteLockfilePath)) {
    return [
      {
        status: 'error',
        project: root.name,
        module: rule.lockfilePath,
        file: rule.lockfilePath,
        line: 1,
        ruleId: rule.id,
        detail: `missing lockfile "${rule.lockfilePath}"`,
        recommendation: rule.recommendation,
      },
    ];
  }

  const lockfileText = readFileSync(absoluteLockfilePath, 'utf8');
  const directDependencyNames = await collectDirectDependencyNames(repoRoot);
  const duplicatePackages = collectPackageVersions(lockfileText).filter((entry) =>
    directDependencyNames.has(entry.packageName),
  );

  return duplicatePackages
    .sort((left, right) => left.packageName.localeCompare(right.packageName))
    .map((entry) => ({
      status: 'error',
      project: root.name,
      module: entry.packageName,
      file: rule.lockfilePath,
      line: entry.line,
      ruleId: rule.id,
      detail: `multiple versions detected: ${[...entry.versions.keys()].sort().join(', ')}`,
      recommendation: rule.recommendation,
    }));
}

export { checkRootLockfileRule, collectPackageVersions, splitBunLockPackageIdentifier };
