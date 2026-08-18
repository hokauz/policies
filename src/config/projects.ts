import type { ProjectPolicies } from '../types';

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
          { name: 'components', definition: 'Module-local React UI and composition components.' },
          { name: 'datasource', definition: 'Data access and API integration for the module.' },
          { name: 'guard', definition: 'Route guards and access control helpers.' },
          { name: 'hooks', definition: 'Feature hooks and module orchestration.' },
          { name: 'model', definition: 'Domain models and shared module types.' },
          { name: 'pages', definition: 'Route-level screens for the module.' },
          { name: 'schemas', definition: 'Validation schemas and form contracts.' },
          { name: 'services', definition: 'Business services and orchestration logic.' },
          { name: 'theme', definition: 'Module-specific theme tokens or styling helpers used by home.' },
          { name: 'utils', definition: 'Pure utilities scoped to the module.' },
        ],
        recommendation:
          'Move the folder into an allowed module folder or update the project config if this top-level folder is intentional.',
      },
    ],
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
  {
    name: 'elysia-api',
    path: 'apps/api',
    folders: [
      {
        type: 'folder',
        id: 'elysia-api-folder-structure',
        baseFolder: 'src/modules',
        allowedFolders: [
          { name: '__tests__', definition: 'Colocated unit tests for the module.' },
          { name: 'queries', definition: 'SQL/query layer split when the module grows.' },
          { name: 'service', definition: 'Service submodules for orchestration splits.' },
          { name: 'occurrence', definition: 'Domain-specific occurrence logic (e.g. transactions).' },
        ],
        recommendation:
          'Move the folder into an allowed module folder or update the project config if this top-level folder is intentional.',
      },
    ],
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

export { projectPolicies };
