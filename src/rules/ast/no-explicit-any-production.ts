import traverse from '@babel/traverse';

import type { AstPolicyRule } from '../../types';

const TEST_FILE_PATTERN = /(^|\/)__tests__\/|\.(test|spec)\.[jt]sx?$/;
const ALLOWED_FILES = new Set([
  'apps/api/src/middlewares/idempotency/index.ts',
  'apps/api/src/shared/handler-errors.ts',
]);

const noExplicitAnyProduction: AstPolicyRule = {
  id: 'no-explicit-any-production',
  kind: 'ast',
  recommendation: 'Use an explicit unknown or domain type instead of any in production code.',
  check(ast, file, violations) {
    if ((!file.startsWith('apps/api/src/') && !file.startsWith('apps/web/src/')) || TEST_FILE_PATTERN.test(file)) {
      return;
    }
    if (ALLOWED_FILES.has(file)) return;

    traverse(ast, {
      TSAnyKeyword(path) {
        violations.push({
          project: file.startsWith('apps/api/') ? 'elysia-api' : 'react-spa',
          module: 'types',
          file,
          line: path.node.loc?.start.line ?? 0,
          ruleId: 'no-explicit-any-production',
          detail: 'explicit any in production source',
          recommendation: 'Use an explicit unknown or domain type instead of any in production code.',
        });
      },
    });
  },
};

export { noExplicitAnyProduction };
