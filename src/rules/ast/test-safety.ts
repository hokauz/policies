import traverse from '@babel/traverse';

import type { AstPolicyRule } from '../../types';

const TEST_FILE_PATTERN = /(^|\/)__tests__\/|\.(test|spec)\.[jt]sx?$/;
const TEST_NAMES = new Set(['it', 'test', 'describe']);
const SKIPPED_NAMES = new Set(['only', 'skip', 'todo']);

const noSkippedTests: AstPolicyRule = {
  id: 'no-skipped-tests',
  kind: 'ast',
  recommendation: 'Remove .only, .skip, and .todo before committing tests.',
  check(ast, file, violations) {
    if (!TEST_FILE_PATTERN.test(file)) return;

    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.object.type !== 'Identifier' || !TEST_NAMES.has(callee.object.name)) return;
        if (callee.property.type !== 'Identifier' || !SKIPPED_NAMES.has(callee.property.name)) return;

        violations.push({
          project: 'monorepo',
          module: 'tests',
          file,
          line: path.node.loc?.start.line ?? 0,
          ruleId: 'no-skipped-tests',
          detail: `remove ${callee.object.name}.${callee.property.name} before committing`,
          recommendation: 'Remove .only, .skip, and .todo before committing tests.',
        });
      },
    });
  },
};

export { noSkippedTests };
