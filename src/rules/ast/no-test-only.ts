import traverse from '@babel/traverse';

import type { AstPolicyRule } from '../../types';

const ONLY_CALLEES = new Set(['it', 'test', 'describe']);

const rule: AstPolicyRule = {
  id: 'no-test-only',
  kind: 'ast',
  recommendation: 'Remove .only before committing — breaks CI parallelism assumptions',
  check(ast, file, violations) {
    if (!file.includes('.test.') && !file.includes('.spec.')) {
      return;
    }

    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;

        if (callee.type !== 'MemberExpression') {
          return;
        }

        if (callee.object.type !== 'Identifier') {
          return;
        }

        if (callee.property.type !== 'Identifier') {
          return;
        }

        if (!ONLY_CALLEES.has(callee.object.name)) {
          return;
        }

        if (callee.property.name !== 'only') {
          return;
        }

        violations.push({
          project: 'monorepo',
          module: 'tests',
          file,
          line: path.node.loc?.start.line ?? 0,
          ruleId: 'no-test-only',
          detail: `remove ${callee.object.name}.only before committing`,
          recommendation: 'Remove .only before committing — breaks CI parallelism assumptions',
        });
      },
    });
  },
};

export { rule };
