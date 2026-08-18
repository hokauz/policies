import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';

import type { PolicyImportViolation } from '../../types';

import { rule } from './no-test-only';

function runRule(code: string, file = 'apps/api/src/modules/plans/__tests__/service.test.ts') {
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript'] });
  const violations: PolicyImportViolation[] = [];
  rule.check(ast, file, violations);
  return violations;
}

describe('no-test-only', () => {
  it('flags it.only', () => {
    expect(runRule('it.only("x", () => {});')).toHaveLength(1);
  });

  it('allows plain it', () => {
    expect(runRule('it("x", () => {});')).toHaveLength(0);
  });
});
