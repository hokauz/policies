import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';

import type {
  CatalogManifest,
  CatalogPatternSet,
  CatalogPolicySet,
  CatalogScanSet,
  LoadedPolicyCatalog,
} from './types';

const policySetSchema = {
  type: 'object',
  required: ['schemaVersion', 'level', 'framework', 'domain'],
  properties: {
    schemaVersion: { const: 1 },
    level: { type: 'string' },
    framework: { type: 'string' },
    domain: { type: 'string' },
    project: {
      type: 'object',
      required: ['name', 'path'],
      properties: {
        name: { type: 'string' },
        path: { type: 'string' },
      },
      additionalProperties: false,
    },
    scan: { type: 'object' },
    patterns: { type: 'object' },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'id'],
        properties: {
          type: { type: 'string' },
          id: { type: 'string' },
        },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
};

const manifestSchema = {
  type: 'object',
  required: ['schemaVersion', 'name', 'policySets'],
  properties: {
    schemaVersion: { const: 1 },
    name: { type: 'string' },
    description: { type: 'string' },
    policySets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['level', 'framework', 'domain', 'path'],
        properties: {
          level: { type: 'string' },
          framework: { type: 'string' },
          domain: { type: 'string' },
          path: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

const knownRuleTypes = new Set([
  'api-route-conventions',
  'export-style',
  'folder-structure',
  'function-call-ban',
  'lockfile-single-version',
  'member-call-ban',
  'member-call-location',
  'member-expression-ban',
  'object-property-numeric-max',
  'restricted-import',
  'restricted-import-pattern',
  'ts-syntax-ban',
]);

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
}

function createAjv(): Ajv {
  return new Ajv({ allErrors: true, strict: false });
}

function validateRuleTypes(policySet: CatalogPolicySet, file: string): void {
  for (const rule of policySet.rules ?? []) {
    if (!knownRuleTypes.has(rule.type)) {
      throw new Error(`Unknown policy rule type "${rule.type}" in ${file}`);
    }
  }
}

function loadPolicyCatalog(repoRoot: string, manifestPath?: string): LoadedPolicyCatalog {
  const candidateManifestPaths = manifestPath
    ? [manifestPath]
    : [
        'policies/catalog/manifest.json',
        'policies/catalog/manifest.json',
        resolve(import.meta.dir, '../../policies/catalog/manifest.json'),
      ];
  const resolvedManifestPath = candidateManifestPaths
    .map((candidate) => resolve(repoRoot, candidate))
    .find((candidate) => existsSync(candidate));
  const absoluteManifestPath = resolvedManifestPath ?? resolve(repoRoot, candidateManifestPaths[0]!);
  if (!existsSync(absoluteManifestPath)) {
    throw new Error(`Missing policy catalog manifest: ${candidateManifestPaths[0]}`);
  }

  const ajv = createAjv();
  const validateManifest = ajv.compile<CatalogManifest>(manifestSchema);
  const validatePolicySet = ajv.compile<CatalogPolicySet>(policySetSchema);
  const manifest = readJsonFile<CatalogManifest>(absoluteManifestPath);
  if (!validateManifest(manifest)) {
    throw new Error(`Invalid policy catalog manifest: ${formatAjvErrors(validateManifest.errors)}`);
  }

  const rootDir = dirname(absoluteManifestPath);
  const policySets: CatalogPolicySet[] = [];
  let scan: CatalogScanSet['scan'] | undefined;
  const patternSources: Record<string, string> = {};

  for (const ref of manifest.policySets) {
    const policySetPath = resolve(rootDir, ref.path);
    if (!existsSync(policySetPath)) {
      throw new Error(`Missing policy set "${ref.path}" referenced by manifest`);
    }

    const policySet = readJsonFile<CatalogPolicySet>(policySetPath);
    if (!validatePolicySet(policySet)) {
      throw new Error(`Invalid policy set "${ref.path}": ${formatAjvErrors(validatePolicySet.errors)}`);
    }
    validateRuleTypes(policySet, ref.path);

    if (policySet.domain === 'scan' && 'scan' in policySet) {
      scan = (policySet as CatalogScanSet).scan;
    }
    if (policySet.domain === 'patterns' && 'patterns' in policySet) {
      Object.assign(patternSources, (policySet as CatalogPatternSet).patterns);
    }

    policySets.push(policySet);
  }

  if (!scan) {
    throw new Error('Policy catalog is missing shared scan configuration');
  }

  const patterns = Object.fromEntries(
    Object.entries(patternSources).map(([name, source]) => [name, new RegExp(source)]),
  );

  return { rootDir, manifest, policySets, scan, patterns };
}

export { loadPolicyCatalog };
