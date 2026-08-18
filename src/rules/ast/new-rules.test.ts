import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';

import type { PolicyImportViolation } from '../../types';

import { apiHandlerBoundary } from './runtime-boundaries';
import { apiRouteConventions } from './api-route-conventions';
import { noSkippedTests } from './test-safety';
import { webQueryLimit } from './runtime-boundaries';

function runRule(
  rule: { check: (ast: any, file: string, violations: PolicyImportViolation[]) => void },
  code: string,
  file: string,
): PolicyImportViolation[] {
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const violations: PolicyImportViolation[] = [];
  rule.check(ast, file, violations);
  return violations;
}

describe('additional policy rules', () => {
  it('flags skipped tests', () => {
    expect(runRule(noSkippedTests, 'it.skip("x", () => {});', 'apps/web/src/foo.test.ts')).toHaveLength(1);
  });

  it('flags query limits above twenty', () => {
    expect(runRule(webQueryLimit, 'const query = { limit: 21 };', 'apps/web/src/foo.ts')).toHaveLength(1);
  });

  it('flags handler data-layer imports', () => {
    expect(
      runRule(
        apiHandlerBoundary,
        "import { FooRepository } from './repository';",
        'apps/api/src/modules/foo/handler.ts',
      ),
    ).toHaveLength(1);
  });

  it('flags route methods without contracts', () => {
    expect(
      runRule(
        apiRouteConventions,
        [
          "import { authPlugin } from '../../middlewares/auth';",
          "import { FOO } from './route-contracts';",
          "new Elysia().get('/foo', handler);",
        ].join('\n'),
        'apps/api/src/modules/foo/route.ts',
      ),
    ).toHaveLength(1);
  });
});
