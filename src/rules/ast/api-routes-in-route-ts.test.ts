import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';

import type { PolicyImportViolation } from '../../types';

import { rule } from './api-routes-in-route-ts';

function runRule(code: string, file = 'apps/api/src/modules/plans/handler.ts') {
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript'] });
  const violations: PolicyImportViolation[] = [];
  rule.check(ast, file, violations);
  return violations;
}

describe('api-routes-in-route-ts', () => {
  it('flags HTTP route declarations outside route.ts', () => {
    expect(
      runRule("new Elysia().get('/plans', () => 'ok');"),
    ).toHaveLength(1);
  });

  it('allows route declarations in route.ts', () => {
    expect(
      runRule("new Elysia().post('', () => 'ok');", 'apps/api/src/modules/plans/route.ts'),
    ).toHaveLength(0);
  });

  it('ignores service.get calls without string-literal paths', () => {
    expect(runRule('await this.service.get(userId, planId);')).toHaveLength(0);
  });
});
