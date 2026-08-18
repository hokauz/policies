import traverse from '@babel/traverse';

import type { AstPolicyRule } from '../../types';

const TEST_FILE_PATTERN = /(^|\/)__tests__\/|\.(test|spec)\.[jt]sx?$/;
const CONSOLE_ALLOWED_FILES = new Set([
  'apps/api/src/migrate.ts',
  'apps/api/src/shared/envs/runtime-env.ts',
  'apps/web/src/env.ts',
]);

const noDirectConsole: AstPolicyRule = {
  id: 'no-direct-console-production',
  kind: 'ast',
  recommendation: 'Use the application logger; direct console output is reserved for bootstrap diagnostics.',
  check(ast, file, violations) {
    if ((!file.startsWith('apps/api/src/') && !file.startsWith('apps/web/src/')) || TEST_FILE_PATTERN.test(file)) {
      return;
    }
    if (CONSOLE_ALLOWED_FILES.has(file)) return;

    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.object.type !== 'Identifier' || callee.object.name !== 'console') return;
        if (callee.property.type !== 'Identifier' || callee.property.name === 'error') return;

        violations.push({
          project: file.startsWith('apps/api/') ? 'elysia-api' : 'react-spa',
          module: 'logging',
          file,
          line: path.node.loc?.start.line ?? 0,
          ruleId: 'no-direct-console-production',
          detail: `direct console.${callee.property.name} call in production source`,
          recommendation: 'Use the application logger; direct console output is reserved for bootstrap diagnostics.',
        });
      },
    });
  },
};

const webQueryLimit: AstPolicyRule = {
  id: 'web-query-limit-max-20',
  kind: 'ast',
  recommendation: 'Keep web query limits at 20 or lower.',
  check(ast, file, violations) {
    if (!file.startsWith('apps/web/src/') || TEST_FILE_PATTERN.test(file)) return;

    traverse(ast, {
      ObjectProperty(path) {
        const key = path.node.key;
        const value = path.node.value;
        const keyName = key.type === 'Identifier' ? key.name : key.type === 'StringLiteral' ? key.value : undefined;
        if (keyName !== 'limit' || value.type !== 'NumericLiteral' || value.value <= 20) return;

        violations.push({
          project: 'react-spa',
          module: 'queries',
          file,
          line: path.node.loc?.start.line ?? 0,
          ruleId: 'web-query-limit-max-20',
          detail: `query limit ${value.value} exceeds the maximum of 20`,
          recommendation: 'Keep web query limits at 20 or lower.',
        });
      },
    });
  },
};

const apiHandlerBoundary: AstPolicyRule = {
  id: 'api-handler-service-boundary',
  kind: 'ast',
  recommendation: 'Handlers should depend on services and shared error helpers, not repositories or databases.',
  check(ast, file, violations) {
    if (!file.startsWith('apps/api/src/modules/') || !file.endsWith('/handler.ts')) return;

    traverse(ast, {
      ImportDeclaration(path) {
        const source = path.node.source.value;
        const forbidden = source.endsWith('/repository') || source.includes('/shared/db');
        if (!forbidden) return;

        violations.push({
          project: 'elysia-api',
          module: file.split('/')[3] ?? 'unknown',
          file,
          line: path.node.loc?.start.line ?? 0,
          ruleId: 'api-handler-service-boundary',
          detail: `handler imports forbidden data-layer dependency "${source}"`,
          recommendation: 'Handlers should depend on services and shared error helpers, not repositories or databases.',
        });
      },
    });
  },
};

export { apiHandlerBoundary, noDirectConsole, webQueryLimit };
