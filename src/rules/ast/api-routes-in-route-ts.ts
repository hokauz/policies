import traverse from '@babel/traverse';

import type { AstPolicyRule } from '../../types';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const TEST_FILE_PATTERN = /(^|\/)__tests__\/|\.test\.[jt]sx?$|\.spec\.[jt]sx?$/;

const rule: AstPolicyRule = {
  id: 'api-routes-in-route-ts',
  kind: 'ast',
  recommendation: 'Declare HTTP routes only in route.ts',
  check(ast, file, violations) {
    if (!file.startsWith('apps/api/src/modules/')) {
      return;
    }

    if (file.endsWith('/route.ts')) {
      return;
    }

    if (TEST_FILE_PATTERN.test(file)) {
      return;
    }

    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;

        if (callee.type !== 'MemberExpression') {
          return;
        }

        if (callee.property.type !== 'Identifier') {
          return;
        }

        if (!HTTP_METHODS.has(callee.property.name)) {
          return;
        }

        const [firstArgument] = path.node.arguments;

        if (!firstArgument || firstArgument.type !== 'StringLiteral') {
          return;
        }

        violations.push({
          project: 'elysia-api',
          module: file.split('/')[3] ?? 'unknown',
          file,
          line: path.node.loc?.start.line ?? 0,
          ruleId: 'api-routes-in-route-ts',
          detail: `HTTP route declaration "${callee.property.name}('${firstArgument.value}')" outside route.ts`,
          recommendation: 'Declare HTTP routes only in route.ts',
        });
      },
    });
  },
};

export { rule };
