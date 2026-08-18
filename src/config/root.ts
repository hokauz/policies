import type { RootPolicies } from '../types';

const rootPolicies: RootPolicies = {
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
};

export { rootPolicies };
