import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';

import type { PolicyImportViolation } from '../../types';

import { rule } from './no-inline-export';

function runRule(code: string, file = 'apps/web/src/shared/utils.ts') {
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const violations: PolicyImportViolation[] = [];
  rule.check(ast, file, violations);
  return violations;
}

describe('no-inline-export', () => {
  it('flags inline export declarations in web source files', () => {
    expect(runRule('export function cn() {}')).toHaveLength(1);
  });

  it('flags inline export declarations in api source files', () => {
    expect(runRule('export const logger = null;', 'apps/api/src/shared/logger.ts')).toHaveLength(1);
  });

  it('allows grouped exports at the bottom', () => {
    expect(runRule('function cn() {}\nexport { cn };')).toHaveLength(0);
  });

  it('allows grouped type exports at the bottom', () => {
    expect(runRule('type Foo = string;\nexport type { Foo };')).toHaveLength(0);
  });

  it('allows re-exports from other modules', () => {
    expect(runRule("export { cn } from './utils';")).toHaveLength(0);
  });

  it('allows export default', () => {
    expect(runRule('export default function Page() { return null; }')).toHaveLength(0);
  });

  it('ignores test files', () => {
    expect(
      runRule('export function helper() {}', 'apps/web/src/shared/utils.test.ts'),
    ).toHaveLength(0);
  });

  it('ignores files outside api and web scopes', () => {
    expect(runRule('export function helper() {}', 'e2e/support/web/helpers.ts')).toHaveLength(0);
  });
});
