import { describe, expect, it } from 'bun:test';

import { formatImportViolation, formatModuleCheckEntry } from './types';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('formatModuleCheckEntry', () => {
  it('keeps ok entries compact', () => {
    const output = stripAnsi(
      formatModuleCheckEntry({
        status: 'ok',
        project: 'react-spa',
        module: 'account',
        ruleId: 'react-spa-folder-structure',
      }),
    );

    expect(output).toBe('  OK react-spa/account');
  });

  it('shows detail and recommendation for errors', () => {
    const output = stripAnsi(
      formatModuleCheckEntry({
        status: 'error',
        project: 'react-spa',
        module: 'plan',
        ruleId: 'react-spa-folder-structure',
        detail: 'unexpected top-level folders: helpers',
        recommendation: 'Move the folder into an allowed module folder.',
      }),
    );

    expect(output).toBe(
      '  Error react-spa/plan — unexpected top-level folders: helpers — Move the folder into an allowed module folder.',
    );
  });
});

describe('formatImportViolation', () => {
  it('renders an import violation with details', () => {
    const output = stripAnsi(
      formatImportViolation({
        project: 'react-spa',
        module: 'shared',
        file: 'apps/web/src/shared/contexts/query-provider.tsx',
        line: 2,
        ruleId: 'react-spa-react-query-imports',
        detail: 'direct import of "@tanstack/react-query" outside src/queries',
        recommendation:
          'Move direct React Query usage into src/queries and keep only that layer importing @tanstack/react-query directly.',
      }),
    );

    expect(output).toContain('Error react-spa/shared (apps/web/src/shared/contexts/query-provider.tsx:2)');
    expect(output).toContain('direct import of "@tanstack/react-query" outside src/queries');
  });
});
