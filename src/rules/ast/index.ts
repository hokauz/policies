import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from '@babel/parser';

import type { AstPolicyRule, PolicyImportViolation } from '../../types';

import { rule as apiRoutesInRouteTs } from './api-routes-in-route-ts';
import { apiRouteConventions } from './api-route-conventions';
import { apiHandlerBoundary, noDirectConsole, webQueryLimit } from './runtime-boundaries';
import { edenClientBoundary, fetchBoundary } from './web-boundaries';
import { rule as noInlineExport } from './no-inline-export';
import { noExplicitAnyProduction } from './no-explicit-any-production';
import { rule as noProcessEnvOutsideLoader } from './no-process-env-outside-loader';
import { rule as noTestOnly } from './no-test-only';
import { noSkippedTests } from './test-safety';

const AST_SCAN_ROOTS = [
  'apps/api/src',
  'apps/web/src',
  'e2e/support',
  'packages',
] as const;

const IGNORE = [
  '/node_modules/',
  '/dist/',
];

const allAstRules: AstPolicyRule[] = [
  noProcessEnvOutsideLoader,
  apiRoutesInRouteTs,
  apiRouteConventions,
  edenClientBoundary,
  fetchBoundary,
  noTestOnly,
  noSkippedTests,
  noExplicitAnyProduction,
  noDirectConsole,
  webQueryLimit,
  apiHandlerBoundary,
  noInlineExport,
];

function shouldScanAstFile(relativePath: string): boolean {
  if (IGNORE.some((part) => relativePath.includes(part))) {
    return false;
  }

  return relativePath.endsWith('.ts') || relativePath.endsWith('.tsx');
}

async function collectAstFiles(repoRoot: string): Promise<string[]> {
  const files: string[] = [];
  const patterns = ['**/*.ts', '**/*.tsx'];

  for (const root of AST_SCAN_ROOTS) {
    for (const pattern of patterns) {
      const glob = new Bun.Glob(pattern);

      for await (const match of glob.scan({
        cwd: resolve(repoRoot, root),
        absolute: true,
        onlyFiles: true,
      })) {
        const rel = match.slice(repoRoot.length + 1);

        if (shouldScanAstFile(rel)) {
          files.push(match);
        }
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function parseAstFile(absPath: string) {
  const code = readFileSync(absPath, 'utf8');

  return parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
    errorRecovery: true,
  });
}

async function runAstPolicies(repoRoot: string): Promise<PolicyImportViolation[]> {
  const violations: PolicyImportViolation[] = [];
  const files = await collectAstFiles(repoRoot);

  for (const absPath of files) {
    const rel = absPath.startsWith(repoRoot) ? absPath.slice(repoRoot.length + 1) : absPath;
    let ast;

    try {
      ast = parseAstFile(absPath);
    } catch {
      continue;
    }

    for (const rule of allAstRules) {
      rule.check(ast, rel, violations);
    }
  }

  return violations;
}

export { allAstRules, runAstPolicies };
