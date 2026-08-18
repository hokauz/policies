import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'bun:test';

import { runProjectPolicies } from '../check';
import type { ProjectPolicies } from '../types';

function createTempRepoRoot(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'mirumo-policies-'));
  mkdirSync(join(repoRoot, 'apps/web/src/modules'), { recursive: true });
  return repoRoot;
}

describe('react-spa folder structure policy', () => {
  it('allows modules that only use approved top-level folders', () => {
    const repoRoot = createTempRepoRoot();
    const modulesRoot = join(repoRoot, 'apps/web/src/modules');

    mkdirSync(join(modulesRoot, 'plan/components'), { recursive: true });
    mkdirSync(join(modulesRoot, 'plan/hooks'), { recursive: true });
    mkdirSync(join(modulesRoot, 'plan/pages'), { recursive: true });

    const projectPolicies: ProjectPolicies[] = [
      {
        name: 'react-spa',
        path: 'apps/web',
        folders: [
          {
            type: 'folder',
            id: 'react-spa-folder-structure',
            baseFolder: 'src/modules',
            allowedFolders: [
              { name: 'components', definition: 'UI' },
              { name: 'hooks', definition: 'Hooks' },
              { name: 'pages', definition: 'Pages' },
            ],
            recommendation: 'Keep module folders within the allowed layout.',
          },
        ],
        imports: [],
      },
    ];

    const entries = runProjectPolicies(repoRoot, projectPolicies);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('ok');
    expect(entries[0]?.project).toBe('react-spa');
    expect(entries[0]?.module).toBe('plan');
  });

  it('flags unexpected top-level folders', () => {
    const repoRoot = createTempRepoRoot();
    const modulesRoot = join(repoRoot, 'apps/web/src/modules');

    mkdirSync(join(modulesRoot, 'plan/components'), { recursive: true });
    mkdirSync(join(modulesRoot, 'plan/helpers'), { recursive: true });

    const violations = runProjectPolicies(repoRoot, [
      {
        name: 'react-spa',
        path: 'apps/web',
        folders: [
          {
            type: 'folder',
            id: 'react-spa-folder-structure',
            baseFolder: 'src/modules',
            allowedFolders: [{ name: 'components', definition: 'UI' }],
            recommendation: 'Keep module folders within the allowed layout.',
            },
          ],
          imports: [],
        },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.status).toBe('error');
    expect(violations[0]?.module).toBe('plan');
    expect(violations[0]?.detail).toContain('helpers');
  });

  it('ignores nested folders below the allowed top level', () => {
    const repoRoot = createTempRepoRoot();
    const modulesRoot = join(repoRoot, 'apps/web/src/modules');

    mkdirSync(join(modulesRoot, 'plan/components/nested/inner'), { recursive: true });

    const projectPolicies: ProjectPolicies[] = [
      {
        name: 'react-spa',
        path: 'apps/web',
        folders: [
          {
            type: 'folder',
            id: 'react-spa-folder-structure',
            baseFolder: 'src/modules',
            allowedFolders: [{ name: 'components', definition: 'UI' }],
            recommendation: 'Keep module folders within the allowed layout.',
          },
        ],
        imports: [],
      },
    ];

    const entries = runProjectPolicies(repoRoot, projectPolicies);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('ok');
    expect(entries[0]?.module).toBe('plan');
  });
});

describe('elysia-api folder structure policy', () => {
  function createApiRepoRoot(): string {
    const repoRoot = mkdtempSync(join(tmpdir(), 'mirumo-policies-api-'));
    mkdirSync(join(repoRoot, 'apps/api/src/modules'), { recursive: true });
    return repoRoot;
  }

  function makeApiProjectPolicies(allowedFolders: ProjectPolicies['folders'][number]['allowedFolders']): ProjectPolicies[] {
    return [
      {
        name: 'elysia-api',
        path: 'apps/api',
        folders: [
          {
            type: 'folder',
            id: 'elysia-api-folder-structure',
            baseFolder: 'src/modules',
            allowedFolders,
            recommendation: 'Keep module folders within the allowed layout.',
          },
        ],
        imports: [],
      },
    ];
  }

  it('allows modules that only use approved top-level folders', () => {
    const repoRoot = createApiRepoRoot();
    const modulesRoot = join(repoRoot, 'apps/api/src/modules');

    mkdirSync(join(modulesRoot, 'plans/__tests__'), { recursive: true });
    mkdirSync(join(modulesRoot, 'plans/queries'), { recursive: true });
    mkdirSync(join(modulesRoot, 'plans/service'), { recursive: true });

    const entries = runProjectPolicies(
      repoRoot,
      makeApiProjectPolicies([
        { name: '__tests__', definition: 'Tests' },
        { name: 'queries', definition: 'Queries' },
        { name: 'service', definition: 'Service' },
      ]),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('ok');
    expect(entries[0]?.project).toBe('elysia-api');
    expect(entries[0]?.module).toBe('plans');
  });

  it('flags unexpected top-level folders', () => {
    const repoRoot = createApiRepoRoot();
    const modulesRoot = join(repoRoot, 'apps/api/src/modules');

    mkdirSync(join(modulesRoot, 'plans/__tests__'), { recursive: true });
    mkdirSync(join(modulesRoot, 'plans/helpers'), { recursive: true });

    const violations = runProjectPolicies(
      repoRoot,
      makeApiProjectPolicies([{ name: '__tests__', definition: 'Tests' }]),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.status).toBe('error');
    expect(violations[0]?.module).toBe('plans');
    expect(violations[0]?.detail).toContain('helpers');
  });
});
