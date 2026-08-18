import traverse from '@babel/traverse';

import type { AstPolicyRule } from '../../types';

const PROJECT_SCOPES = [
  { prefix: 'apps/api/src/', project: 'elysia-api' },
  { prefix: 'apps/web/src/', project: 'react-spa' },
] as const;

const TEST_FILE_PATTERN = /(^|\/)__tests__\/|\.test\.[jt]sx?$|\.spec\.[jt]sx?$/;

function resolveProject(file: string): (typeof PROJECT_SCOPES)[number] | undefined {
  return PROJECT_SCOPES.find((scope) => file.startsWith(scope.prefix));
}

function getInlineExportDetail(declarationType: string | undefined): string {
  if (!declarationType) {
    return 'inline export declaration';
  }

  return `inline export ${declarationType}`;
}

const rule: AstPolicyRule = {
  id: 'no-inline-export',
  kind: 'ast',
  recommendation:
    'Declare symbols without export and group exports at the bottom with export { ... } or export type { ... }',
  check(ast, file, violations) {
    const scope = resolveProject(file);

    if (!scope) {
      return;
    }

    if (TEST_FILE_PATTERN.test(file)) {
      return;
    }

    traverse(ast, {
      ExportNamedDeclaration(path) {
        if (!path.node.declaration) {
          return;
        }

        violations.push({
          project: scope.project,
          module: 'exports',
          file,
          line: path.node.loc?.start.line ?? 0,
          ruleId: 'no-inline-export',
          detail: getInlineExportDetail(path.node.declaration.type),
          recommendation:
            'Declare symbols without export and group exports at the bottom with export { ... } or export type { ... }',
        });
      },
    });
  },
};

export { rule };
