import type { RulesLogic } from 'json-logic-js';

import type { PolicyImportViolation, PolicyModuleCheckEntry, ProjectFolderDefinition } from '../types';

type CatalogRuleKind = 'folder' | 'import' | 'lockfile' | 'ast';

interface CatalogProject {
  name: string;
  path: string;
}

interface CatalogPolicySetRef {
  level: string;
  framework: string;
  domain: string;
  path: string;
}

interface CatalogManifest {
  schemaVersion: number;
  name: string;
  description?: string;
  policySets: CatalogPolicySetRef[];
}

interface CatalogScope {
  includePrefixes?: string[];
  includeSuffixes?: string[];
  includePathContains?: string[];
  includePatternRefs?: string[];
  allowedFiles?: string[];
  allowedSuffixes?: string[];
  exceptionFiles?: string[];
  ignorePatternRefs?: string[];
}

interface CatalogPatternSet {
  schemaVersion: number;
  level: string;
  framework: string;
  domain: string;
  patterns: Record<string, string>;
}

interface CatalogScanSet {
  schemaVersion: number;
  level: string;
  framework: string;
  domain: string;
  scan: {
    roots: string[];
    patterns: string[];
    ignorePathParts: string[];
  };
}

interface CatalogPolicySet {
  schemaVersion: number;
  level: string;
  framework: string;
  domain: string;
  project?: CatalogProject;
  rules?: CatalogRule[];
}

interface CatalogFolderStructureRule {
  type: 'folder-structure';
  id: string;
  baseFolder: string;
  allowedFolders: ProjectFolderDefinition[];
  recommendation: string;
}

interface CatalogLockfileRule {
  type: 'lockfile-single-version';
  id: string;
  lockfilePath: string;
  recommendation: string;
}

interface CatalogRestrictedImportRule {
  type: 'restricted-import';
  id: string;
  project?: string;
  scan?: { folder?: string };
  scope?: CatalogScope;
  match: { source: string };
  allow?: {
    folders?: string[];
    files?: string[];
    prefixes?: string[];
    pathContains?: string[];
  };
  display?: {
    baseFolder?: string;
    allowedLocations?: string[];
  };
  module?: string;
  detail?: string;
  recommendation: string;
  when?: RulesLogic;
}

interface CatalogRestrictedImportPatternRule {
  type: 'restricted-import-pattern';
  id: string;
  project: string;
  scope: CatalogScope;
  forbiddenSourceSuffixes?: string[];
  forbiddenSourceContains?: string[];
  moduleFromPathSegment?: number;
  detailTemplate: string;
  recommendation: string;
  when?: RulesLogic;
}

interface CatalogMemberCallBanRule {
  type: 'member-call-ban';
  id: string;
  project?: string;
  projects?: CatalogProjectScope[];
  scope?: CatalogScope;
  object?: string;
  objects?: string[];
  properties?: string[];
  excludedProperties?: string[];
  module: string;
  detailTemplate: string;
  recommendation: string;
  when?: RulesLogic;
}

interface CatalogFunctionCallBanRule {
  type: 'function-call-ban';
  id: string;
  project: string;
  scope: CatalogScope;
  functionName: string;
  module: string;
  detail: string;
  recommendation: string;
  when?: RulesLogic;
}

interface CatalogMemberExpressionBanRule {
  type: 'member-expression-ban';
  id: string;
  project: string;
  scope: CatalogScope;
  match: { object: string; property: string };
  module: string;
  detail: string;
  recommendation: string;
  when?: RulesLogic;
}

interface CatalogObjectPropertyNumericMaxRule {
  type: 'object-property-numeric-max';
  id: string;
  project: string;
  scope: CatalogScope;
  property: string;
  max: number;
  module: string;
  detailTemplate: string;
  recommendation: string;
  when?: RulesLogic;
}

interface CatalogTsSyntaxBanRule {
  type: 'ts-syntax-ban';
  id: string;
  projects: CatalogProjectScope[];
  scope?: CatalogScope;
  nodeType: string;
  module: string;
  detail: string;
  recommendation: string;
  when?: RulesLogic;
}

interface CatalogExportStyleRule {
  type: 'export-style';
  id: string;
  projects: CatalogProjectScope[];
  scope?: CatalogScope;
  disallowNamedDeclarationExports: boolean;
  allowReExports: boolean;
  allowDefaultExport: boolean;
  module: string;
  detailTemplate: string;
  recommendation: string;
  when?: RulesLogic;
}

interface CatalogMemberCallLocationRule {
  type: 'member-call-location';
  id: string;
  project: string;
  scope: CatalogScope;
  match: {
    methods: string[];
    firstArgumentType?: string;
  };
  moduleFromPathSegment?: number;
  detailTemplate: string;
  recommendation: string;
  when?: RulesLogic;
}

interface CatalogApiRouteConventionsRule {
  type: 'api-route-conventions';
  id: string;
  project: string;
  scope: CatalogScope;
  requires: CatalogApiRouteRequirement[];
  recommendation: string;
}

interface CatalogApiRouteRequirement {
  type: 'import-local-name' | 'import-source-suffix' | 'route-third-argument';
  ruleId: string;
  localName?: string;
  sourceSuffix?: string;
  methods?: string[];
  detail?: string;
  detailTemplate?: string;
  recommendation: string;
}

interface CatalogProjectScope {
  project: string;
  prefix: string;
}

type CatalogRule =
  | CatalogFolderStructureRule
  | CatalogLockfileRule
  | CatalogRestrictedImportRule
  | CatalogRestrictedImportPatternRule
  | CatalogMemberCallBanRule
  | CatalogFunctionCallBanRule
  | CatalogMemberExpressionBanRule
  | CatalogObjectPropertyNumericMaxRule
  | CatalogTsSyntaxBanRule
  | CatalogExportStyleRule
  | CatalogMemberCallLocationRule
  | CatalogApiRouteConventionsRule;

interface LoadedPolicyCatalog {
  rootDir: string;
  manifest: CatalogManifest;
  policySets: CatalogPolicySet[];
  scan: CatalogScanSet['scan'];
  patterns: Record<string, RegExp>;
}

interface CatalogRuleDescriptor {
  id: string;
  kind: CatalogRuleKind;
  scope: string;
  recommendation: string;
}

interface CatalogProjectPolicies {
  name: string;
  path: string;
  folders: CatalogFolderStructureRule[];
  imports: CatalogRestrictedImportRule[];
}

interface CatalogRunResult {
  rootPolicies: {
    name: string;
    lockfiles: CatalogLockfileRule[];
  };
  projectPolicies: CatalogProjectPolicies[];
  astRules: CatalogRuleDescriptor[];
  rootEntries: PolicyModuleCheckEntry[];
  folderEntries: PolicyModuleCheckEntry[];
  importViolations: PolicyImportViolation[];
  astViolations: PolicyImportViolation[];
}

export type {
  CatalogApiRouteConventionsRule,
  CatalogExportStyleRule,
  CatalogFolderStructureRule,
  CatalogFunctionCallBanRule,
  CatalogLockfileRule,
  CatalogManifest,
  CatalogMemberCallBanRule,
  CatalogMemberCallLocationRule,
  CatalogMemberExpressionBanRule,
  CatalogObjectPropertyNumericMaxRule,
  CatalogPatternSet,
  CatalogPolicySet,
  CatalogProject,
  CatalogProjectPolicies,
  CatalogRestrictedImportPatternRule,
  CatalogRestrictedImportRule,
  CatalogRule,
  CatalogRuleDescriptor,
  CatalogRunResult,
  CatalogScanSet,
  CatalogScope,
  CatalogTsSyntaxBanRule,
  LoadedPolicyCatalog,
};
