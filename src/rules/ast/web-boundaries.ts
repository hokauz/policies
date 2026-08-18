import traverse from '@babel/traverse';

import type { AstPolicyRule } from '../../types';

const EDEN_IMPORT = '@/shared/api/eden-client';
const EDEN_ALLOWED_PREFIXES = [
  'apps/web/src/shared/api/',
  'apps/web/src/shared/stores/auth.store.ts',
  'apps/web/src/modules/',
] as const;

const FETCH_ALLOWED_FILES = new Set([
  'apps/web/src/shared/api/eden-client.ts',
  'apps/web/src/shared/utils/http-client.ts',
]);

const TEST_FILE_PATTERN = /(^|\/)__tests__\/|\.(test|spec)\.[jt]sx?$/;

function isAllowedEdenFile(file: string): boolean {
  return EDEN_ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
    (file.startsWith('apps/web/src/modules/') && file.includes('/datasource/'));
}

const edenClientBoundary: AstPolicyRule = {
  id: 'web-eden-client-boundary',
  kind: 'ast',
  recommendation:
    'Use edenApi only in shared API infrastructure or module datasource files; consume it elsewhere through queries.',
  check(ast, file, violations) {
    if (!file.startsWith('apps/web/src/') || TEST_FILE_PATTERN.test(file)) return;

    traverse(ast, {
      ImportDeclaration(path) {
        if (path.node.source.value !== EDEN_IMPORT || isAllowedEdenFile(file)) return;

        violations.push({
          project: 'react-spa',
          module: 'api-boundary',
          file,
          line: path.node.loc?.start.line ?? 0,
          ruleId: 'web-eden-client-boundary',
          detail: `direct import of "${EDEN_IMPORT}" outside datasource/shared API files`,
          recommendation:
            'Use edenApi only in shared API infrastructure or module datasource files; consume it elsewhere through queries.',
        });
      },
    });
  },
};

const fetchBoundary: AstPolicyRule = {
  id: 'web-fetch-boundary',
  kind: 'ast',
  recommendation: 'Use the shared HTTP client or edenApi instead of calling fetch directly.',
  check(ast, file, violations) {
    if (!file.startsWith('apps/web/src/') || TEST_FILE_PATTERN.test(file)) return;
    if (FETCH_ALLOWED_FILES.has(file)) return;

    traverse(ast, {
      CallExpression(path) {
        if (path.node.callee.type !== 'Identifier' || path.node.callee.name !== 'fetch') return;

        violations.push({
          project: 'react-spa',
          module: 'api-boundary',
          file,
          line: path.node.loc?.start.line ?? 0,
          ruleId: 'web-fetch-boundary',
          detail: 'direct fetch call outside shared HTTP infrastructure',
          recommendation: 'Use the shared HTTP client or edenApi instead of calling fetch directly.',
        });
      },
    });
  },
};

export { edenClientBoundary, fetchBoundary };
