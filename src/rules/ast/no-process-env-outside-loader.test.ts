import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';

import type { PolicyImportViolation } from '../../types';

import { rule } from './no-process-env-outside-loader';

function runRule(code: string, file = 'apps/api/src/modules/plans/service.ts') {
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript'] });
  const violations: PolicyImportViolation[] = [];
  rule.check(ast, file, violations);
  return violations;
}

describe('no-process-env-outside-loader', () => {
  it('flags process.env outside env-loader.ts', () => {
    expect(runRule('const port = process.env.PORT;')).toHaveLength(1);
  });

  it('allows process.env in env-loader.ts', () => {
    expect(runRule('const env = process.env;', 'apps/api/src/shared/envs/env-loader.ts')).toHaveLength(0);
  });

  it('allows process.env in migrate.ts', () => {
    expect(runRule('const dbUrl = process.env.DB_URL;', 'apps/api/src/migrate.ts')).toHaveLength(0);
  });
});
