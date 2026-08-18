import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'bun:test';

import { runProjectImportPolicies } from '../check';
import type { ProjectPolicies } from '../types';
import { collectCatalogFacts } from './facts';
import { loadPolicyCatalog } from './loader';
import { runCatalogPolicies } from './engine';

function makeRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'mirumo-policy-catalog-'));
  mkdirSync(join(repoRoot, 'policies/catalog/shared'), { recursive: true });
  mkdirSync(join(repoRoot, 'policies/catalog/web/react'), { recursive: true });
  mkdirSync(join(repoRoot, 'apps/web/src/queries'), { recursive: true });
  mkdirSync(join(repoRoot, 'apps/web/src/modules/foo'), { recursive: true });

  writeFileSync(
    join(repoRoot, 'package.json'),
    JSON.stringify({ workspaces: ['apps/*', 'packages/*'] }, null, 2),
  );
  writeFileSync(
    join(repoRoot, 'policies/catalog/manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        name: 'test-catalog',
        policySets: [
          { level: 'shared', framework: 'workspace', domain: 'scan', path: 'shared/scan.json' },
          { level: 'shared', framework: 'workspace', domain: 'patterns', path: 'shared/patterns.json' },
          { level: 'web', framework: 'react', domain: 'queries', path: 'web/react/queries.json' },
        ],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(repoRoot, 'policies/catalog/shared/scan.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        level: 'shared',
        framework: 'workspace',
        domain: 'scan',
        scan: {
          roots: ['apps/web/src'],
          patterns: ['**/*.ts', '**/*.tsx'],
          ignorePathParts: ['/node_modules/', '/dist/'],
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(repoRoot, 'policies/catalog/shared/patterns.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        level: 'shared',
        framework: 'workspace',
        domain: 'patterns',
        patterns: { testFiles: '(^|/)__tests__/|\\.(test|spec)\\.[jt]sx?$' },
      },
      null,
      2,
    ),
  );

  return repoRoot;
}

function writeReactQueryRule(repoRoot: string, extraRule = {}): void {
  writeFileSync(
    join(repoRoot, 'policies/catalog/web/react/queries.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        level: 'web',
        framework: 'react',
        domain: 'queries',
        project: { name: 'react-spa', path: 'apps/web' },
        rules: [
          {
            type: 'restricted-import',
            id: 'react-spa-react-query-imports',
            match: { source: '@tanstack/react-query' },
            scan: { folder: 'apps/web/src' },
            allow: { folders: ['apps/web/src/queries'] },
            display: { baseFolder: 'src', allowedLocations: ['queries'] },
            recommendation:
              'Move direct React Query usage into src/queries and keep only that layer importing @tanstack/react-query directly.',
            ...extraRule,
          },
        ],
      },
      null,
      2,
    ),
  );
}

describe('policy catalog loader', () => {
  it('loads the repository catalog manifest and policy sets', () => {
    const repoRoot = join(import.meta.dir, '../../../..');
    const catalog = loadPolicyCatalog(repoRoot);

    expect(catalog.manifest.name).toBe('project-policy-catalog');
    expect(catalog.policySets.length).toBeGreaterThan(0);
    expect(catalog.patterns.testFiles?.test('apps/web/src/foo.test.ts')).toBe(true);
  });

  it('fails when a manifest references a missing policy set', () => {
    const repoRoot = makeRepo();
    writeFileSync(
      join(repoRoot, 'policies/catalog/manifest.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          name: 'bad-catalog',
          policySets: [{ level: 'web', framework: 'react', domain: 'queries', path: 'missing.json' }],
        },
        null,
        2,
      ),
    );

    expect(() => loadPolicyCatalog(repoRoot)).toThrow(/Missing policy set/);
  });

  it('fails on unknown rule types', () => {
    const repoRoot = makeRepo();
    writeReactQueryRule(repoRoot, { type: 'unknown-rule-type' });

    expect(() => loadPolicyCatalog(repoRoot)).toThrow(/Unknown policy rule type/);
  });
});

describe('policy catalog facts and evaluator', () => {
  it('collects generic AST facts for imports, calls, object properties, exports and any', async () => {
    const repoRoot = makeRepo();
    writeReactQueryRule(repoRoot);
    writeFileSync(
      join(repoRoot, 'apps/web/src/modules/foo/sample.tsx'),
      [
        "import { useQuery } from '@tanstack/react-query';",
        'export function Sample(input: any) {',
        '  fetch("/api");',
        '  console.log({ limit: 21 });',
        '  return input;',
        '}',
      ].join('\n'),
    );

    const facts = await collectCatalogFacts(repoRoot, loadPolicyCatalog(repoRoot));

    expect(facts.imports.some((fact) => fact.source === '@tanstack/react-query')).toBe(true);
    expect(facts.calls.some((fact) => fact.functionName === 'fetch')).toBe(true);
    expect(facts.objectProperties.some((fact) => fact.keyName === 'limit' && fact.numericValue === 21)).toBe(true);
    expect(facts.exports.some((fact) => fact.declarationType === 'FunctionDeclaration')).toBe(true);
    expect(facts.tsSyntax.some((fact) => fact.nodeType === 'TSAnyKeyword')).toBe(true);
  });

  it('evaluates restricted-import with match and allow semantics', async () => {
    const repoRoot = makeRepo();
    writeReactQueryRule(repoRoot);
    writeFileSync(
      join(repoRoot, 'apps/web/src/queries/query.ts'),
      "import { useQuery } from '@tanstack/react-query';\n",
    );
    writeFileSync(
      join(repoRoot, 'apps/web/src/modules/foo/component.tsx'),
      "import { useQuery } from '@tanstack/react-query';\n",
    );

    const result = await runCatalogPolicies(repoRoot);

    expect(result.importViolations).toHaveLength(1);
    expect(result.importViolations[0]).toMatchObject({
      project: 'react-spa',
      module: 'modules',
      file: 'apps/web/src/modules/foo/component.tsx',
      line: 1,
      ruleId: 'react-spa-react-query-imports',
      detail: 'direct import of "@tanstack/react-query" outside queries',
    });
  });

  it('matches the legacy React Query import policy output', async () => {
    const repoRoot = makeRepo();
    writeReactQueryRule(repoRoot);
    writeFileSync(
      join(repoRoot, 'apps/web/src/modules/foo/component.tsx'),
      "import type { QueryClient } from '@tanstack/react-query';\n",
    );

    const legacyPolicies: ProjectPolicies[] = [
      {
        name: 'react-spa',
        path: 'apps/web',
        folders: [],
        imports: [
          {
            type: 'import',
            id: 'react-spa-react-query-imports',
            baseFolder: 'src',
            allowedFolders: ['queries'],
            moduleSpecifier: '@tanstack/react-query',
            recommendation:
              'Move direct React Query usage into src/queries and keep only that layer importing @tanstack/react-query directly.',
          },
        ],
      },
    ];

    const legacy = await runProjectImportPolicies(repoRoot, legacyPolicies);
    const catalog = await runCatalogPolicies(repoRoot);

    expect(catalog.importViolations).toEqual(legacy);
  });
});
