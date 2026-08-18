import traverse from '@babel/traverse';

import type { AstPolicyRule } from '../../types';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function addViolation(
  violations: Parameters<AstPolicyRule['check']>[2],
  file: string,
  ruleId: string,
  detail: string,
  recommendation: string,
  line: number,
): void {
  violations.push({
    project: 'elysia-api',
    module: file.split('/')[3] ?? 'unknown',
    file,
    line,
    ruleId,
    detail,
    recommendation,
  });
}

const apiRouteConventions: AstPolicyRule = {
  id: 'api-route-conventions',
  kind: 'ast',
  recommendation: 'Private API routes must use authPlugin and every route must declare its contract.',
  check(ast, file, violations) {
    if (!file.startsWith('apps/api/src/modules/') || !file.endsWith('/route.ts')) return;

    const isHealthRoute = file === 'apps/api/src/modules/health/route.ts';
    let hasAuthPlugin = false;
    let hasContractsImport = false;

    traverse(ast, {
      ImportDeclaration(path) {
        for (const specifier of path.node.specifiers) {
          if (specifier.local.name === 'authPlugin') hasAuthPlugin = true;
        }
        if (path.node.source.value.endsWith('/route-contracts')) hasContractsImport = true;
      },
    });

    if (!isHealthRoute && !hasAuthPlugin) {
      addViolation(
        violations,
        file,
        'api-private-route-auth',
        'private module route does not import authPlugin',
        'Use authPlugin for private module routes; add an explicit exception only for public routes.',
        1,
      );
    }

    if (!isHealthRoute && !hasContractsImport) {
      addViolation(
        violations,
        file,
        'api-route-contract-import',
        'module route does not import route-contracts',
        'Declare and use the Eden contract from the module route-contracts file.',
        1,
      );
    }

    if (isHealthRoute) return;

    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return;
        if (!HTTP_METHODS.has(callee.property.name)) return;

        const firstArgument = path.node.arguments[0];
        if (!firstArgument || firstArgument.type !== 'StringLiteral') return;
        if (path.node.arguments.length >= 3) return;

        addViolation(
          violations,
          file,
          'api-route-contract-required',
          `HTTP route declaration "${callee.property.name}('${firstArgument.value}')" has no contract`,
          'Pass the corresponding route contract as the third argument to the Elysia route method.',
          path.node.loc?.start.line ?? 0,
        );
      },
    });
  },
};

export { apiRouteConventions };
