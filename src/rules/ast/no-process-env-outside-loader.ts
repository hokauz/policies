import traverse from '@babel/traverse';

import type { AstPolicyRule } from '../../types';

const ALLOWED_FILES = new Set([
  'apps/api/src/shared/envs/env-loader.ts',
  'apps/api/src/migrate.ts',
]);

const rule: AstPolicyRule = {
  id: 'no-process-env-outside-loader',
  kind: 'ast',
  recommendation: 'Read env only via src/shared/envs/env-loader.ts',
  check(ast, file, violations) {
    if (!file.startsWith('apps/api/src/')) {
      return;
    }

    if (ALLOWED_FILES.has(file)) {
      return;
    }

    traverse(ast, {
      MemberExpression(path) {
        const object = path.node.object;

        if (
          object.type === 'Identifier' &&
          object.name === 'process' &&
          path.node.property.type === 'Identifier' &&
          path.node.property.name === 'env'
        ) {
          violations.push({
            project: 'elysia-api',
            module: 'env',
            file,
            line: path.node.loc?.start.line ?? 0,
            ruleId: 'no-process-env-outside-loader',
            detail: 'direct process.env access outside env-loader.ts',
            recommendation: 'Read env only via src/shared/envs/env-loader.ts',
          });
        }
      },
    });
  },
};

export { rule };
