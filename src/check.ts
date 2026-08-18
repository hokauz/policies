import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { checkRootLockfileRule } from './rules/bun-lock-single-version';
import { checkProjectImportRule } from './rules/import-direct-react-query';
import type {
  PolicyCheckEntry,
  PolicyImportViolation,
  PolicyModuleCheckEntry,
  ProjectFolderRule,
  ProjectPolicies,
  RootPolicies,
} from './types';

function toRepoRelativePath(repoRoot: string, absolutePath: string): string {
  return absolutePath.startsWith(repoRoot) ? absolutePath.slice(repoRoot.length + 1) : absolutePath;
}

function checkProjectFolderRule(
  repoRoot: string,
  project: ProjectPolicies,
  rule: ProjectFolderRule,
): PolicyCheckEntry[] {
  const entries: PolicyCheckEntry[] = [];
  const baseFolderPath = resolve(repoRoot, project.path, rule.baseFolder);
  const baseFolderRelativePath = toRepoRelativePath(repoRoot, baseFolderPath);

  if (!existsSync(baseFolderPath)) {
    entries.push({
      status: 'error',
      project: project.name,
      module: rule.baseFolder,
      folder: rule.baseFolder,
      file: baseFolderRelativePath,
      line: 1,
      ruleId: rule.id,
      detail: `missing base folder "${rule.baseFolder}"`,
      recommendation: rule.recommendation,
    });
    return entries;
  }

  const moduleEntries = readdirSync(baseFolderPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  const allowedFolders = new Map(rule.allowedFolders.map((folder) => [folder.name, folder.definition]));

  for (const moduleEntry of moduleEntries) {
    const modulePath = join(baseFolderPath, moduleEntry.name);
    const topLevelEntries = readdirSync(modulePath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of topLevelEntries) {
      const definition = allowedFolders.get(entry.name);
      if (definition) {
        entries.push({
          status: 'ok',
          project: project.name,
          module: moduleEntry.name,
          folder: entry.name,
          file: toRepoRelativePath(repoRoot, join(modulePath, entry.name)),
          line: 1,
          ruleId: rule.id,
          detail: definition,
          recommendation: rule.recommendation,
        });

        continue;
      }

      entries.push({
        status: 'error',
        project: project.name,
        module: moduleEntry.name,
        folder: entry.name,
        file: toRepoRelativePath(repoRoot, join(modulePath, entry.name)),
        line: 1,
        ruleId: rule.id,
        detail: `unexpected top-level folder "${entry.name}" in module "${moduleEntry.name}"`,
        recommendation: rule.recommendation,
      });
    }
  }

  return entries;
}

function summarizeProjectEntries(entries: PolicyCheckEntry[]): PolicyModuleCheckEntry[] {
  const summaryByModule = new Map<string, PolicyModuleCheckEntry & { folders: string[] }>();

  for (const entry of entries) {
    const key = `${entry.project}::${entry.module}::${entry.ruleId}`;
    const existing = summaryByModule.get(key);

    if (!existing) {
      summaryByModule.set(key, {
        status: entry.status,
        project: entry.project,
        module: entry.module,
        ruleId: entry.ruleId,
        detail: entry.status === 'error' ? entry.detail : undefined,
        recommendation: entry.status === 'error' ? entry.recommendation : undefined,
        folders: entry.status === 'error' ? [entry.folder] : [],
      });
      continue;
    }

    if (entry.status === 'error') {
      existing.status = 'error';
      existing.folders.push(entry.folder);
      existing.detail = `unexpected top-level folders: ${Array.from(new Set(existing.folders)).sort().join(', ')}`;
      existing.recommendation = entry.recommendation;
      continue;
    }
  }

  return Array.from(summaryByModule.values()).map(({ folders: _folders, ...summary }) => summary);
}

function runProjectPolicies(repoRoot: string, projects: ProjectPolicies[]): PolicyModuleCheckEntry[] {
  const entries: PolicyCheckEntry[] = [];

  for (const project of projects) {
    for (const rule of project.folders) {
      if (rule.type !== 'folder') {
        continue;
      }

      entries.push(...checkProjectFolderRule(repoRoot, project, rule));
    }
  }

  return summarizeProjectEntries(entries);
}

async function runProjectImportPolicies(
  repoRoot: string,
  projects: ProjectPolicies[],
): Promise<PolicyImportViolation[]> {
  const violations: PolicyImportViolation[] = [];

  for (const project of projects) {
    for (const rule of project.imports) {
      if (rule.type !== 'import') {
        continue;
      }

      violations.push(...(await checkProjectImportRule(repoRoot, project, rule)));
    }
  }

  return violations;
}

async function runRootPolicies(repoRoot: string, roots: RootPolicies[]): Promise<PolicyModuleCheckEntry[]> {
  const entries: PolicyModuleCheckEntry[] = [];

  for (const root of roots) {
    for (const rule of root.lockfiles) {
      if (rule.type !== 'lockfile') {
        continue;
      }

      entries.push(...(await checkRootLockfileRule(repoRoot, root, rule)));
    }
  }

  return entries;
}

export { checkProjectFolderRule, runProjectImportPolicies, runProjectPolicies, runRootPolicies, summarizeProjectEntries };
export { allAstRules, runAstPolicies } from './rules/ast';
