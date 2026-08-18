import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'bun:test';

import { runProjectImportPolicies } from '../check';
import type { ProjectPolicies } from '../types';

function createTempRepoRoot(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'mirumo-policies-'));
  mkdirSync(join(repoRoot, 'apps/web/src/queries'), { recursive: true });
  mkdirSync(join(repoRoot, 'apps/web/src/shared/contexts'), { recursive: true });
  return repoRoot;
}

function makeProjectPolicies(): ProjectPolicies[] {
  return [
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
}

describe('react-spa react-query import policy', () => {
  it('allows direct imports inside src/queries', async () => {
    const repoRoot = createTempRepoRoot();

    writeFileSync(
      join(repoRoot, 'apps/web/src/queries/query-provider.tsx'),
      [
        "import { QueryClientProvider } from '@tanstack/react-query';",
        '',
        'export function QueryProvider() {',
        '  return null;',
        '}',
        '',
      ].join('\n'),
    );

    const violations = await runProjectImportPolicies(repoRoot, makeProjectPolicies());

    expect(violations).toHaveLength(0);
  });

  it('flags direct imports outside src/queries', async () => {
    const repoRoot = createTempRepoRoot();

    writeFileSync(
      join(repoRoot, 'apps/web/src/shared/contexts/query-provider.tsx'),
      [
        "import { QueryClientProvider } from '@tanstack/react-query';",
        '',
        'export function QueryProvider() {',
        '  return null;',
        '}',
        '',
      ].join('\n'),
    );

    const violations = await runProjectImportPolicies(repoRoot, makeProjectPolicies());

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toContain('shared/contexts/query-provider.tsx');
    expect(violations[0]?.detail).toContain('@tanstack/react-query');
  });
});

describe('elysia-api postgres import policy', () => {
  function createApiRepoRoot(): string {
    const repoRoot = mkdtempSync(join(tmpdir(), 'mirumo-policies-api-'));
    mkdirSync(join(repoRoot, 'apps/api/src/shared/db/adapter'), { recursive: true });
    mkdirSync(join(repoRoot, 'apps/api/src/modules/plans'), { recursive: true });
    return repoRoot;
  }

  function makeApiProjectPolicies(): ProjectPolicies[] {
    return [
      {
        name: 'elysia-api',
        path: 'apps/api',
        folders: [],
        imports: [
          {
            type: 'import',
            id: 'elysia-api-postgres-imports',
            baseFolder: 'src',
            allowedFolders: ['shared/db'],
            allowedFiles: ['src/migrate.ts'],
            moduleSpecifier: 'postgres',
            recommendation:
              'Import postgres only from src/shared/db; use the Database adapter elsewhere.',
          },
        ],
      },
    ];
  }

  it('allows direct imports inside src/shared/db', async () => {
    const repoRoot = createApiRepoRoot();

    writeFileSync(
      join(repoRoot, 'apps/api/src/shared/db/adapter/postgres-database.ts'),
      [
        "import postgres from 'postgres';",
        '',
        'export function connect() {',
        '  return postgres("");',
        '}',
        '',
      ].join('\n'),
    );

    const violations = await runProjectImportPolicies(repoRoot, makeApiProjectPolicies());

    expect(violations).toHaveLength(0);
  });

  it('allows direct imports in src/migrate.ts', async () => {
    const repoRoot = createApiRepoRoot();

    writeFileSync(
      join(repoRoot, 'apps/api/src/migrate.ts'),
      [
        "import postgres from 'postgres';",
        '',
        'export async function migrate() {',
        '  return null;',
        '}',
        '',
      ].join('\n'),
    );

    const violations = await runProjectImportPolicies(repoRoot, makeApiProjectPolicies());

    expect(violations).toHaveLength(0);
  });

  it('flags direct imports outside allowed locations', async () => {
    const repoRoot = createApiRepoRoot();

    writeFileSync(
      join(repoRoot, 'apps/api/src/modules/plans/service.ts'),
      [
        "import postgres from 'postgres';",
        '',
        'export function run() {',
        '  return null;',
        '}',
        '',
      ].join('\n'),
    );

    const violations = await runProjectImportPolicies(repoRoot, makeApiProjectPolicies());

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toContain('modules/plans/service.ts');
    expect(violations[0]?.detail).toContain('postgres');
  });
});
