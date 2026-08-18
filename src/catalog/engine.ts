import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import jsonLogic from 'json-logic-js';

import { collectPackageVersions } from '../rules/bun-lock-single-version';
import type { PolicyCheckEntry, PolicyImportViolation, PolicyModuleCheckEntry } from '../types';
import { summarizeProjectEntries } from '../check';
import { collectCatalogFacts } from './facts';
import type { CatalogFacts } from './facts';
import { loadPolicyCatalog } from './loader';
import type {
  CatalogApiRouteConventionsRule,
  CatalogExportStyleRule,
  CatalogFolderStructureRule,
  CatalogFunctionCallBanRule,
  CatalogLockfileRule,
  CatalogMemberCallBanRule,
  CatalogMemberCallLocationRule,
  CatalogMemberExpressionBanRule,
  CatalogObjectPropertyNumericMaxRule,
  CatalogPolicySet,
  CatalogProject,
  CatalogProjectPolicies,
  CatalogRestrictedImportPatternRule,
  CatalogRestrictedImportRule,
  CatalogRule,
  CatalogRuleDescriptor,
  CatalogRunResult,
  CatalogScope,
  CatalogTsSyntaxBanRule,
  LoadedPolicyCatalog,
} from './types';
import { resolveWithinRoot } from '../path-safety';

interface RuleContext {
  catalog: LoadedPolicyCatalog;
  facts: CatalogFacts;
}

interface PackageJsonLike {
  workspaces?: string[];
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
}

const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

jsonLogic.add_operation('startsWith', (value: unknown, prefix: unknown) =>
  typeof value === 'string' && typeof prefix === 'string' && value.startsWith(prefix),
);
jsonLogic.add_operation('endsWith', (value: unknown, suffix: unknown) =>
  typeof value === 'string' && typeof suffix === 'string' && value.endsWith(suffix),
);
jsonLogic.add_operation('includes', (value: unknown, part: unknown) =>
  typeof value === 'string' && typeof part === 'string' && value.includes(part),
);

function toRepoRelativePath(repoRoot: string, absolutePath: string): string {
  return absolutePath.startsWith(repoRoot) ? absolutePath.slice(repoRoot.length + 1) : absolutePath;
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function matchesPatternRefs(file: string, patternRefs: string[] | undefined, catalog: LoadedPolicyCatalog): boolean {
  return (patternRefs ?? []).some((ref) => catalog.patterns[ref]?.test(file));
}

function isInScope(file: string, scope: CatalogScope | undefined, catalog: LoadedPolicyCatalog): boolean {
  if (!scope) return true;
  if ((scope.exceptionFiles ?? []).includes(file)) return false;
  if ((scope.allowedFiles ?? []).includes(file)) return false;
  if ((scope.allowedSuffixes ?? []).some((suffix) => file.endsWith(suffix))) return false;
  if (matchesPatternRefs(file, scope.ignorePatternRefs, catalog)) return false;
  if (scope.includePrefixes && !scope.includePrefixes.some((prefix) => file.startsWith(prefix))) return false;
  if (scope.includeSuffixes && !scope.includeSuffixes.some((suffix) => file.endsWith(suffix))) return false;
  if (scope.includePathContains && !scope.includePathContains.some((part) => file.includes(part))) return false;
  if (scope.includePatternRefs && !matchesPatternRefs(file, scope.includePatternRefs, catalog)) return false;

  return true;
}

function fileMatchesProject(file: string, projects: { project: string; prefix: string }[]): string | undefined {
  return projects.find((project) => file.startsWith(project.prefix))?.project;
}

function moduleFromPath(file: string, segment = 3): string {
  return file.split('/')[segment] ?? 'unknown';
}

function applyTemplate(template: string, values: Record<string, string | number | undefined>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

function allowedByPath(file: string, rule: CatalogRestrictedImportRule): boolean {
  const allow = rule.allow ?? {};
  return Boolean(
    (allow.files ?? []).includes(file) ||
      (allow.folders ?? []).some((folder) => file === folder || file.startsWith(`${folder}/`)) ||
      (allow.prefixes ?? []).some((prefix) => file.startsWith(prefix)) ||
      (allow.pathContains ?? []).some((part) => file.includes(part)),
  );
}

function importRuleScope(rule: CatalogRestrictedImportRule, policySet: CatalogPolicySet): CatalogScope | undefined {
  if (rule.scope) return rule.scope;
  const scanFolder = rule.scan?.folder ?? (policySet.project ? `${policySet.project.path}/${rule.display?.baseFolder ?? ''}` : undefined);
  return scanFolder ? { includePrefixes: [scanFolder.endsWith('/') ? scanFolder : `${scanFolder}/`], ignorePatternRefs: ['testFiles'] } : undefined;
}

function resolveImportRuleProject(rule: CatalogRestrictedImportRule, policySet: CatalogPolicySet): string {
  return rule.project ?? policySet.project?.name ?? 'monorepo';
}

function importRuleModule(file: string, rule: CatalogRestrictedImportRule, policySet: CatalogPolicySet): string {
  if (rule.module) return rule.module;
  const scanFolder = rule.scan?.folder ?? (policySet.project ? `${policySet.project.path}/${rule.display?.baseFolder ?? ''}` : '');
  const normalizedScanFolder = scanFolder.endsWith('/') ? scanFolder : `${scanFolder}/`;
  const relative = file.startsWith(normalizedScanFolder) ? file.slice(normalizedScanFolder.length) : file;
  return relative.split('/')[0] ?? 'root';
}

function restrictedImportDetail(rule: CatalogRestrictedImportRule): string {
  if (rule.detail) return rule.detail;
  const allowedLocations = rule.display?.allowedLocations ?? rule.allow?.folders ?? rule.allow?.files ?? [];
  return `direct import of "${rule.match.source}" outside ${allowedLocations.join(', ')}`;
}

function evaluateRestrictedImportRule(
  rule: CatalogRestrictedImportRule,
  policySet: CatalogPolicySet,
  context: RuleContext,
): PolicyImportViolation[] {
  const scope = importRuleScope(rule, policySet);
  const condition = rule.when ?? {
    and: [
      { '==': [{ var: 'source' }, rule.match.source] },
      { '!': [{ var: 'allowed' }] },
    ],
  };

  return context.facts.imports.flatMap((fact) => {
    if (!isInScope(fact.file, scope, context.catalog)) return [];
    const allowed = allowedByPath(fact.file, rule);
    const matches = jsonLogic.apply(condition, { ...fact, allowed });
    if (!matches) return [];

    return [
      {
        project: resolveImportRuleProject(rule, policySet),
        module: importRuleModule(fact.file, rule, policySet),
        file: fact.file,
        line: fact.line,
        ruleId: rule.id,
        detail: restrictedImportDetail(rule),
        recommendation: rule.recommendation,
      },
    ];
  });
}

function evaluateRestrictedImportPatternRule(
  rule: CatalogRestrictedImportPatternRule,
  context: RuleContext,
): PolicyImportViolation[] {
  return context.facts.imports.flatMap((fact) => {
    if (!isInScope(fact.file, rule.scope, context.catalog)) return [];
    const forbidden = (rule.forbiddenSourceSuffixes ?? []).some((suffix) => fact.source.endsWith(suffix)) ||
      (rule.forbiddenSourceContains ?? []).some((part) => fact.source.includes(part));
    const matches = jsonLogic.apply(rule.when ?? { var: 'forbidden' }, { ...fact, forbidden });
    if (!matches) return [];

    return [
      {
        project: rule.project,
        module: moduleFromPath(fact.file, rule.moduleFromPathSegment),
        file: fact.file,
        line: fact.line,
        ruleId: rule.id,
        detail: applyTemplate(rule.detailTemplate, { source: fact.source }),
        recommendation: rule.recommendation,
      },
    ];
  });
}

function evaluateMemberCallBanRule(rule: CatalogMemberCallBanRule, context: RuleContext): PolicyImportViolation[] {
  return context.facts.calls.flatMap((fact) => {
    if (fact.calleeType !== 'member') return [];
    if (!isInScope(fact.file, rule.scope, context.catalog)) return [];

    const project = rule.projects ? fileMatchesProject(fact.file, rule.projects) : rule.project;
    if (rule.projects && !project) return [];

    const objects = rule.objects ?? (rule.object ? [rule.object] : []);
    const objectMatches = objects.length === 0 || (fact.object ? objects.includes(fact.object) : false);
    const propertyAllowed = !fact.property || !(rule.excludedProperties ?? []).includes(fact.property);
    const propertyMatches = rule.properties ? Boolean(fact.property && rule.properties.includes(fact.property)) : propertyAllowed;
    const matches = jsonLogic.apply(rule.when ?? { and: [{ var: 'objectMatches' }, { var: 'propertyMatches' }] }, {
      ...fact,
      objectMatches,
      propertyMatches,
    });
    if (!matches) return [];

    return [
      {
        project: project ?? 'monorepo',
        module: rule.module,
        file: fact.file,
        line: fact.line,
        ruleId: rule.id,
        detail: applyTemplate(rule.detailTemplate, { object: fact.object, property: fact.property }),
        recommendation: rule.recommendation,
      },
    ];
  });
}

function evaluateFunctionCallBanRule(rule: CatalogFunctionCallBanRule, context: RuleContext): PolicyImportViolation[] {
  return context.facts.calls.flatMap((fact) => {
    if (fact.calleeType !== 'identifier' || fact.functionName !== rule.functionName) return [];
    if (!isInScope(fact.file, rule.scope, context.catalog)) return [];
    if (!jsonLogic.apply(rule.when ?? true, fact)) return [];

    return [
      {
        project: rule.project,
        module: rule.module,
        file: fact.file,
        line: fact.line,
        ruleId: rule.id,
        detail: rule.detail,
        recommendation: rule.recommendation,
      },
    ];
  });
}

function evaluateMemberExpressionBanRule(rule: CatalogMemberExpressionBanRule, context: RuleContext): PolicyImportViolation[] {
  return context.facts.memberExpressions.flatMap((fact) => {
    if (!isInScope(fact.file, rule.scope, context.catalog)) return [];
    if (fact.object !== rule.match.object || fact.property !== rule.match.property) return [];
    if (!jsonLogic.apply(rule.when ?? true, fact)) return [];

    return [
      {
        project: rule.project,
        module: rule.module,
        file: fact.file,
        line: fact.line,
        ruleId: rule.id,
        detail: rule.detail,
        recommendation: rule.recommendation,
      },
    ];
  });
}

function evaluateObjectPropertyNumericMaxRule(
  rule: CatalogObjectPropertyNumericMaxRule,
  context: RuleContext,
): PolicyImportViolation[] {
  return context.facts.objectProperties.flatMap((fact) => {
    if (!isInScope(fact.file, rule.scope, context.catalog)) return [];
    if (fact.keyName !== rule.property || fact.numericValue === undefined || fact.numericValue <= rule.max) return [];
    if (!jsonLogic.apply(rule.when ?? true, fact)) return [];

    return [
      {
        project: rule.project,
        module: rule.module,
        file: fact.file,
        line: fact.line,
        ruleId: rule.id,
        detail: applyTemplate(rule.detailTemplate, { value: fact.numericValue }),
        recommendation: rule.recommendation,
      },
    ];
  });
}

function evaluateTsSyntaxBanRule(rule: CatalogTsSyntaxBanRule, context: RuleContext): PolicyImportViolation[] {
  return context.facts.tsSyntax.flatMap((fact) => {
    const project = fileMatchesProject(fact.file, rule.projects);
    if (!project) return [];
    if (!isInScope(fact.file, rule.scope, context.catalog)) return [];
    if (fact.nodeType !== rule.nodeType) return [];
    if (!jsonLogic.apply(rule.when ?? true, fact)) return [];

    return [
      {
        project,
        module: rule.module,
        file: fact.file,
        line: fact.line,
        ruleId: rule.id,
        detail: rule.detail,
        recommendation: rule.recommendation,
      },
    ];
  });
}

function evaluateExportStyleRule(rule: CatalogExportStyleRule, context: RuleContext): PolicyImportViolation[] {
  return context.facts.exports.flatMap((fact) => {
    const project = fileMatchesProject(fact.file, rule.projects);
    if (!project) return [];
    if (!isInScope(fact.file, rule.scope, context.catalog)) return [];
    if (fact.isDefault && rule.allowDefaultExport) return [];
    if (fact.isReExport && rule.allowReExports) return [];
    if (!rule.disallowNamedDeclarationExports || !fact.hasDeclaration) return [];
    if (!jsonLogic.apply(rule.when ?? true, fact)) return [];

    return [
      {
        project,
        module: rule.module,
        file: fact.file,
        line: fact.line,
        ruleId: rule.id,
        detail: applyTemplate(rule.detailTemplate, { declarationType: fact.declarationType }),
        recommendation: rule.recommendation,
      },
    ];
  });
}

function evaluateMemberCallLocationRule(rule: CatalogMemberCallLocationRule, context: RuleContext): PolicyImportViolation[] {
  return context.facts.calls.flatMap((fact) => {
    if (fact.calleeType !== 'member') return [];
    if (!isInScope(fact.file, rule.scope, context.catalog)) return [];
    if (!fact.property || !rule.match.methods.includes(fact.property)) return [];
    if (rule.match.firstArgumentType && fact.firstArgumentType !== rule.match.firstArgumentType) return [];
    if (!jsonLogic.apply(rule.when ?? true, fact)) return [];

    return [
      {
        project: rule.project,
        module: moduleFromPath(fact.file, rule.moduleFromPathSegment),
        file: fact.file,
        line: fact.line,
        ruleId: rule.id,
        detail: applyTemplate(rule.detailTemplate, { method: fact.property, path: fact.firstArgumentValue }),
        recommendation: rule.recommendation,
      },
    ];
  });
}

function evaluateApiRouteConventionsRule(
  rule: CatalogApiRouteConventionsRule,
  context: RuleContext,
): PolicyImportViolation[] {
  const violations: PolicyImportViolation[] = [];
  const summaries = context.facts.fileSummaries.filter((fact) => isInScope(fact.file, rule.scope, context.catalog));

  for (const summary of summaries) {
    for (const requirement of rule.requires) {
      if (requirement.type === 'import-local-name' && requirement.localName) {
        if (summary.importLocalNames.includes(requirement.localName)) continue;
        violations.push({
          project: rule.project,
          module: moduleFromPath(summary.file, 3),
          file: summary.file,
          line: 1,
          ruleId: requirement.ruleId,
          detail: requirement.detail ?? '',
          recommendation: requirement.recommendation,
        });
      }

      if (requirement.type === 'import-source-suffix' && requirement.sourceSuffix) {
        if (summary.importSources.some((source) => source.endsWith(requirement.sourceSuffix ?? ''))) continue;
        violations.push({
          project: rule.project,
          module: moduleFromPath(summary.file, 3),
          file: summary.file,
          line: 1,
          ruleId: requirement.ruleId,
          detail: requirement.detail ?? '',
          recommendation: requirement.recommendation,
        });
      }
    }
  }

  const routeContractRequirement = rule.requires.find((requirement) => requirement.type === 'route-third-argument');
  if (routeContractRequirement) {
    for (const fact of context.facts.calls) {
      if (fact.calleeType !== 'member') continue;
      if (!isInScope(fact.file, rule.scope, context.catalog)) continue;
      if (!fact.property || !(routeContractRequirement.methods ?? []).includes(fact.property)) continue;
      if (fact.firstArgumentType !== 'StringLiteral' || fact.argumentCount >= 3) continue;

      violations.push({
        project: rule.project,
        module: moduleFromPath(fact.file, 3),
        file: fact.file,
        line: fact.line,
        ruleId: routeContractRequirement.ruleId,
        detail: applyTemplate(routeContractRequirement.detailTemplate ?? '', {
          method: fact.property,
          path: fact.firstArgumentValue,
        }),
        recommendation: routeContractRequirement.recommendation,
      });
    }
  }

  return violations;
}

function checkFolderStructureRule(
  repoRoot: string,
  project: CatalogProject,
  rule: CatalogFolderStructureRule,
): PolicyCheckEntry[] {
  const entries: PolicyCheckEntry[] = [];
  const baseFolderPath = resolve(repoRoot, project.path, rule.baseFolder);
  const baseFolderRelativePath = toRepoRelativePath(repoRoot, baseFolderPath);

  if (!existsSync(baseFolderPath)) {
    return [
      {
        status: 'error',
        project: project.name,
        module: rule.baseFolder,
        folder: rule.baseFolder,
        file: baseFolderRelativePath,
        line: 1,
        ruleId: rule.id,
        detail: `missing base folder "${rule.baseFolder}"`,
        recommendation: rule.recommendation,
      },
    ];
  }

  const allowedFolders = new Map(rule.allowedFolders.map((folder) => [folder.name, folder.definition]));
  const moduleEntries = readdirSync(baseFolderPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const moduleEntry of moduleEntries) {
    const modulePath = join(baseFolderPath, moduleEntry.name);
    const topLevelEntries = readdirSync(modulePath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of topLevelEntries) {
      const definition = allowedFolders.get(entry.name);
      entries.push({
        status: definition ? 'ok' : 'error',
        project: project.name,
        module: moduleEntry.name,
        folder: entry.name,
        file: toRepoRelativePath(repoRoot, join(modulePath, entry.name)),
        line: 1,
        ruleId: rule.id,
        detail: definition ?? `unexpected top-level folder "${entry.name}" in module "${moduleEntry.name}"`,
        recommendation: rule.recommendation,
      });
    }
  }

  return entries;
}

async function collectWorkspacePackageJsonPaths(repoRoot: string): Promise<string[]> {
  const rootPackageJsonPath = resolve(repoRoot, 'package.json');
  const rootPackageJson = readJsonFile<PackageJsonLike>(rootPackageJsonPath);
  const paths = new Set<string>([rootPackageJsonPath]);

  for (const workspacePattern of rootPackageJson?.workspaces ?? []) {
    const glob = new Bun.Glob(`${workspacePattern}/package.json`);
    for await (const match of glob.scan({ cwd: repoRoot, absolute: true, onlyFiles: true })) {
      paths.add(resolveWithinRoot(repoRoot, match));
    }
  }

  return [...paths].sort((left, right) => left.localeCompare(right));
}

async function collectDirectDependencyNames(repoRoot: string): Promise<Set<string>> {
  const names = new Set<string>();

  for (const packageJsonPath of await collectWorkspacePackageJsonPaths(repoRoot)) {
    const packageJson = readJsonFile<PackageJsonLike>(packageJsonPath);
    if (!packageJson) continue;

    for (const section of dependencySections) {
      for (const dependencyName of Object.keys(packageJson[section] ?? {})) {
        names.add(dependencyName);
      }
    }
  }

  return names;
}

async function checkLockfileRule(repoRoot: string, rule: CatalogLockfileRule): Promise<PolicyModuleCheckEntry[]> {
  const absoluteLockfilePath = resolveWithinRoot(repoRoot, rule.lockfilePath);
  if (!existsSync(absoluteLockfilePath)) {
    return [
      {
        status: 'error',
        project: 'monorepo',
        module: rule.lockfilePath,
        file: rule.lockfilePath,
        line: 1,
        ruleId: rule.id,
        detail: `missing lockfile "${rule.lockfilePath}"`,
        recommendation: rule.recommendation,
      },
    ];
  }

  const directDependencyNames = await collectDirectDependencyNames(repoRoot);
  const duplicatePackages = collectPackageVersions(readFileSync(absoluteLockfilePath, 'utf8')).filter((entry) =>
    directDependencyNames.has(entry.packageName),
  );

  return duplicatePackages
    .sort((left, right) => left.packageName.localeCompare(right.packageName))
    .map((entry) => ({
      status: 'error',
      project: 'monorepo',
      module: entry.packageName,
      file: rule.lockfilePath,
      line: entry.line,
      ruleId: rule.id,
      detail: `multiple versions detected: ${[...entry.versions.keys()].sort().join(', ')}`,
      recommendation: rule.recommendation,
    }));
}

function describeAstRule(rule: CatalogRule): CatalogRuleDescriptor | null {
  if (rule.type === 'folder-structure' || rule.type === 'lockfile-single-version' || rule.type === 'restricted-import') {
    return null;
  }

  return {
    id: rule.id,
    kind: 'ast',
    scope: rule.id,
    recommendation: rule.recommendation,
  };
}

async function runCatalogPolicies(repoRoot: string): Promise<CatalogRunResult> {
  const catalog = loadPolicyCatalog(repoRoot);
  const facts = await collectCatalogFacts(repoRoot, catalog);
  const context = { catalog, facts };
  const rootEntries: PolicyModuleCheckEntry[] = [];
  const folderCheckEntries: PolicyCheckEntry[] = [];
  const importViolations: PolicyImportViolation[] = [];
  const astViolations: PolicyImportViolation[] = [];
  const rootLockfiles: CatalogLockfileRule[] = [];
  const projects = new Map<string, CatalogProjectPolicies>();
  const astRules: CatalogRuleDescriptor[] = [];

  for (const policySet of catalog.policySets) {
    for (const rule of policySet.rules ?? []) {
      const astRule = describeAstRule(rule);
      if (astRule) astRules.push(astRule);

      if (rule.type === 'lockfile-single-version') {
        rootLockfiles.push(rule);
        rootEntries.push(...(await checkLockfileRule(repoRoot, rule)));
      } else if (rule.type === 'folder-structure' && policySet.project) {
        const project = getOrCreateProject(projects, policySet.project);
        project.folders.push(rule);
        folderCheckEntries.push(...checkFolderStructureRule(repoRoot, policySet.project, rule));
      } else if (rule.type === 'restricted-import') {
        const projectName = resolveImportRuleProject(rule, policySet);
        const projectPath = policySet.project?.path ?? inferProjectPath(projectName);
        const project = getOrCreateProject(projects, { name: projectName, path: projectPath });
        project.imports.push(rule);
        importViolations.push(...evaluateRestrictedImportRule(rule, policySet, context));
      } else if (rule.type === 'restricted-import-pattern') {
        astViolations.push(...evaluateRestrictedImportPatternRule(rule, context));
      } else if (rule.type === 'member-call-ban') {
        astViolations.push(...evaluateMemberCallBanRule(rule, context));
      } else if (rule.type === 'function-call-ban') {
        astViolations.push(...evaluateFunctionCallBanRule(rule, context));
      } else if (rule.type === 'member-expression-ban') {
        astViolations.push(...evaluateMemberExpressionBanRule(rule, context));
      } else if (rule.type === 'object-property-numeric-max') {
        astViolations.push(...evaluateObjectPropertyNumericMaxRule(rule, context));
      } else if (rule.type === 'ts-syntax-ban') {
        astViolations.push(...evaluateTsSyntaxBanRule(rule, context));
      } else if (rule.type === 'export-style') {
        astViolations.push(...evaluateExportStyleRule(rule, context));
      } else if (rule.type === 'member-call-location') {
        astViolations.push(...evaluateMemberCallLocationRule(rule, context));
      } else if (rule.type === 'api-route-conventions') {
        astViolations.push(...evaluateApiRouteConventionsRule(rule, context));
      }
    }
  }

  return {
    rootPolicies: { name: 'monorepo', lockfiles: rootLockfiles },
    projectPolicies: [...projects.values()],
    astRules,
    rootEntries,
    folderEntries: summarizeProjectEntries(folderCheckEntries),
    importViolations,
    astViolations,
  };
}

function inferProjectPath(projectName: string): string {
  if (projectName === 'react-spa') return 'apps/web';
  if (projectName === 'elysia-api') return 'apps/api';
  return '.';
}

function getOrCreateProject(projects: Map<string, CatalogProjectPolicies>, project: CatalogProject): CatalogProjectPolicies {
  const existing = projects.get(project.name);
  if (existing) return existing;

  const created = {
    name: project.name,
    path: project.path,
    folders: [],
    imports: [],
  };
  projects.set(project.name, created);
  return created;
}

export { runCatalogPolicies };
