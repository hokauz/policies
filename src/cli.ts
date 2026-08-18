import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { runCatalogPolicies } from './catalog/engine';
import type { CatalogProjectPolicies, CatalogRestrictedImportRule, CatalogRuleDescriptor } from './catalog/types';
import {
  formatImportViolation,
  formatModuleCheckEntry,
  formatRuleReportFooter,
  formatRuleReportHeader,
} from './index';
import type { PolicyImportViolation, PolicyModuleCheckEntry } from './types';

function printBlankLine(): void {
  console.log('');
}

function printProjectFolderReports(
  project: CatalogProjectPolicies,
  folderEntries: PolicyModuleCheckEntry[],
): boolean {
  let hasErrors = false;

  for (const folderRule of project.folders) {
    const currentFolderEntries = folderEntries.filter(
      (entry) => entry.project === project.name && entry.ruleId === folderRule.id,
    );
    const folderHasErrors = currentFolderEntries.some((entry) => entry.status === 'error');
    hasErrors = hasErrors || folderHasErrors;

    console.log(
      formatRuleReportHeader({
        project: project.name,
        ruleId: folderRule.id,
        kind: 'folder',
        scope: `${project.path}/${folderRule.baseFolder}`,
        status: folderHasErrors ? 'error' : 'ok',
        modules: currentFolderEntries,
        violations: [],
        recommendation: folderRule.recommendation,
      }),
    );

    for (const entry of currentFolderEntries) {
      console.log(formatModuleCheckEntry(entry));
    }

    console.log(
      formatRuleReportFooter({
        project: project.name,
        ruleId: folderRule.id,
        kind: 'folder',
        scope: `${project.path}/${folderRule.baseFolder}`,
        status: folderHasErrors ? 'error' : 'ok',
        modules: currentFolderEntries,
        violations: [],
        recommendation: folderRule.recommendation,
      }),
    );
    printBlankLine();
  }

  return hasErrors;
}

function getImportAllowedLocations(importRule: CatalogRestrictedImportRule): string[] {
  return importRule.display?.allowedLocations ??
    importRule.allow?.folders ??
    importRule.allow?.files ??
    importRule.allow?.prefixes ??
    [];
}

function getImportBaseFolder(importRule: CatalogRestrictedImportRule): string {
  return importRule.display?.baseFolder ?? importRule.scan?.folder ?? '';
}

function formatImportScope(project: CatalogProjectPolicies, importRule: CatalogRestrictedImportRule): string {
  const allowedLocations = getImportAllowedLocations(importRule).join(', ');

  return `${project.path}/${getImportBaseFolder(importRule)} (allowed: ${allowedLocations})`;
}

function printProjectImportReports(
  project: CatalogProjectPolicies,
  importViolations: PolicyImportViolation[],
): boolean {
  let hasErrors = false;

  for (const importRule of project.imports) {
    const currentImportViolations = importViolations.filter((violation) => violation.ruleId === importRule.id);
    const errorModules = Array.from(new Set(currentImportViolations.map((violation) => violation.module))).sort();
    const moduleNames = Array.from(new Set([...getImportAllowedLocations(importRule), ...errorModules])).sort();
    const importHasErrors = currentImportViolations.length > 0;
    hasErrors = hasErrors || importHasErrors;
    const allowedLocations = getImportAllowedLocations(importRule).join(', ');

    console.log(
      formatRuleReportHeader({
        project: project.name,
        ruleId: importRule.id,
        kind: 'import',
        scope: formatImportScope(project, importRule),
        status: importHasErrors ? 'error' : 'ok',
        modules: [],
        violations: currentImportViolations,
        recommendation: importRule.recommendation,
      }),
    );

    for (const moduleName of moduleNames) {
      const moduleHasError = errorModules.includes(moduleName);
      console.log(
        formatModuleCheckEntry({
          status: moduleHasError ? 'error' : 'ok',
          project: project.name,
          module: moduleName,
          ruleId: importRule.id,
          detail: moduleHasError
            ? `direct import of "${importRule.match.source}" outside ${allowedLocations}`
            : undefined,
          recommendation: importRule.recommendation,
        }),
      );
    }

    console.log(
      formatRuleReportFooter({
        project: project.name,
        ruleId: importRule.id,
        kind: 'import',
        scope: `${project.path}/${getImportBaseFolder(importRule)}`,
        status: importHasErrors ? 'error' : 'ok',
        modules: [],
        violations: currentImportViolations,
        recommendation: importRule.recommendation,
      }),
    );
    printBlankLine();
  }

  return hasErrors;
}

function printAstRuleReports(astRules: CatalogRuleDescriptor[], astViolations: PolicyImportViolation[]): boolean {
  let hasErrors = false;

  for (const astRule of astRules) {
    const currentViolations = astViolations.filter((violation) => violation.ruleId === astRule.id);
    const ruleHasErrors = currentViolations.length > 0;
    hasErrors = hasErrors || ruleHasErrors;

    console.log(
      formatRuleReportHeader({
        project: 'monorepo',
        ruleId: astRule.id,
        kind: 'ast',
        scope: astRule.scope,
        status: ruleHasErrors ? 'error' : 'ok',
        modules: [],
        violations: currentViolations,
        recommendation: astRule.recommendation,
      }),
    );

    if (currentViolations.length === 0) {
      console.log(
        formatModuleCheckEntry({
          status: 'ok',
          project: 'monorepo',
          module: astRule.id,
          ruleId: astRule.id,
        }),
      );
    } else {
      for (const violation of currentViolations) {
        console.log(formatImportViolation(violation));
      }
    }

    console.log(
      formatRuleReportFooter({
        project: 'monorepo',
        ruleId: astRule.id,
        kind: 'ast',
        scope: astRule.scope,
        status: ruleHasErrors ? 'error' : 'ok',
        modules: [],
        violations: currentViolations,
        recommendation: astRule.recommendation,
      }),
    );
    printBlankLine();
  }

  return hasErrors;
}

async function main(): Promise<void> {
  const targetPath = process.argv[2];
  const repoRoot = resolve(targetPath ?? process.cwd());
  const catalogResult = await runCatalogPolicies(repoRoot);
  const projectRoots = catalogResult.projectPolicies
    .map((project) => project.path)
    .filter((path) => path !== '.')
    .map((path) => resolve(repoRoot, path));

  for (const projectRoot of projectRoots) {
    if (!existsSync(projectRoot)) {
      console.error(`Missing project root: ${projectRoot}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log('Testing policies:');
  printBlankLine();

  const rootErrors = catalogResult.rootEntries.some((entry) => entry.status === 'error');

  for (const rootRule of catalogResult.rootPolicies.lockfiles) {
    const currentRootEntries = catalogResult.rootEntries.filter((entry) => entry.ruleId === rootRule.id);
    const rootHasErrors = currentRootEntries.some((entry) => entry.status === 'error');

    console.log(
      formatRuleReportHeader({
        project: catalogResult.rootPolicies.name,
        ruleId: rootRule.id,
        kind: 'lockfile',
        scope: rootRule.lockfilePath,
        status: rootHasErrors ? 'error' : 'ok',
        modules: currentRootEntries,
        violations: [],
        recommendation: rootRule.recommendation,
      }),
    );

    if (currentRootEntries.length === 0) {
      console.log(
        formatModuleCheckEntry({
          status: 'ok',
          project: catalogResult.rootPolicies.name,
          module: rootRule.lockfilePath,
          ruleId: rootRule.id,
        }),
      );
    } else {
      for (const entry of currentRootEntries) {
        console.log(formatModuleCheckEntry(entry));
      }
    }

    console.log(
      formatRuleReportFooter({
        project: catalogResult.rootPolicies.name,
        ruleId: rootRule.id,
        kind: 'lockfile',
        scope: rootRule.lockfilePath,
        status: rootHasErrors ? 'error' : 'ok',
        modules: currentRootEntries,
        violations: [],
        recommendation: rootRule.recommendation,
      }),
    );
    printBlankLine();
  }

  if (catalogResult.projectPolicies.length === 0) {
    console.error('No project policies configured.');
    process.exitCode = 1;
    return;
  }

  let folderErrors = false;
  let importErrors = false;

  for (const project of catalogResult.projectPolicies) {
    folderErrors = printProjectFolderReports(project, catalogResult.folderEntries) || folderErrors;
    importErrors = printProjectImportReports(project, catalogResult.importViolations) || importErrors;
  }

  const astErrors = printAstRuleReports(catalogResult.astRules, catalogResult.astViolations);

  if (rootErrors || folderErrors || importErrors || astErrors) {
    console.error('❌ POLICY VIOLATIONS:');
    console.error('Fix violations before committing.');
    process.exitCode = 1;
    return;
  }

  console.log(
    `✅ project policies OK (${[
      catalogResult.rootPolicies.name,
      ...catalogResult.projectPolicies.map((project) => project.name),
    ].join(', ')})`,
  );
}

await main();
