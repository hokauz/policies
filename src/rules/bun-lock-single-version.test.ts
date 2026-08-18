import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'bun:test';

import { runRootPolicies } from '../check';
import type { RootPolicies } from '../types';

function createTempRepoRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mirumo-policies-'));
}

function writeWorkspacePackageJson(repoRoot: string, relativePath: string, json: Record<string, unknown>): void {
  const filePath = join(repoRoot, relativePath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`);
}

function makeRootPolicies(): RootPolicies[] {
  return [
    {
      name: 'monorepo',
      lockfiles: [
        {
          type: 'lockfile',
          id: 'bun-lock-single-version',
          lockfilePath: 'bun.lock',
          recommendation:
            'Keep a single resolved version for each package across the monorepo to preserve consistency and cross-compatibility.',
        },
      ],
    },
  ];
}

function writeBaseWorkspaceFiles(repoRoot: string): void {
  writeWorkspacePackageJson(repoRoot, 'package.json', {
    name: 'mirumo',
    private: true,
    workspaces: ['apps/*', 'packages/*', 'e2e'],
    devDependencies: {
      prettier: '3.8.3',
    },
  });

  writeWorkspacePackageJson(repoRoot, 'apps/web/package.json', {
    name: '@mirumo/web',
    private: true,
    dependencies: {
      '@mirumo/api-contracts': 'workspace:*',
      zod: '4.4.3',
    },
  });
}

describe('bun lock single version policy', () => {
  it('ignores duplicated transitive packages that are not direct dependencies', async () => {
    const repoRoot = createTempRepoRoot();
    writeBaseWorkspaceFiles(repoRoot);

    writeFileSync(
      join(repoRoot, 'bun.lock'),
      [
        'lockfileVersion: 1',
        'configVersion: 1',
        '  "workspaces": {',
        '    "": {',
        '      name: "mirumo",',
        '    },',
        '  },',
        '  "packages": {',
        '    "debug": ["debug@4.3.4", "", {}, "sha512-a"],',
        '    "debug-alt": ["debug@4.4.3", "", {}, "sha512-b"],',
        '    "zod": ["zod@4.4.3", "", {}, "sha512-c"],',
        '  },',
        '',
      ].join('\n'),
    );

    const violations = await runRootPolicies(repoRoot, makeRootPolicies());

    expect(violations).toHaveLength(0);
  });

  it('flags only direct dependencies that resolve to more than one version', async () => {
    const repoRoot = createTempRepoRoot();
    writeBaseWorkspaceFiles(repoRoot);

    writeWorkspacePackageJson(repoRoot, 'packages/api-contracts/package.json', {
      name: '@mirumo/api-contracts',
      private: true,
      devDependencies: {
        typescript: '~5.9.3',
      },
    });

    writeWorkspacePackageJson(repoRoot, 'apps/api/package.json', {
      name: '@mirumo/api',
      private: true,
      dependencies: {
        zod: '^4.4.3',
      },
    });

    writeFileSync(
      join(repoRoot, 'bun.lock'),
      [
        'lockfileVersion: 1',
        'configVersion: 1',
        '  "workspaces": {',
        '    "": {',
        '      name: "mirumo",',
        '    },',
        '  },',
        '  "packages": {',
        '    "debug": ["debug@4.3.4", "", {}, "sha512-a"],',
        '    "debug-alt": ["debug@4.4.3", "", {}, "sha512-b"],',
        '    "typescript": ["typescript@5.9.3", "", {}, "sha512-c"],',
        '    "typescript-alt": ["typescript@6.0.3", "", {}, "sha512-d"],',
        '    "zod": ["zod@4.4.3", "", {}, "sha512-e"],',
        '    "zod-alt": ["zod@3.25.76", "", {}, "sha512-f"],',
        '  },',
        '',
      ].join('\n'),
    );

    const violations = await runRootPolicies(repoRoot, makeRootPolicies());

    expect(violations.map((entry) => entry.module).sort()).toEqual(['typescript', 'zod']);
    expect(violations).toHaveLength(2);
    expect(violations[0]?.detail).toContain('multiple versions detected');
  });
});
