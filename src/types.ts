import type { File } from '@babel/types';

interface PolicyCheckEntry {
  status: 'ok' | 'error';
  project: string;
  module: string;
  folder: string;
  file: string;
  line: number;
  ruleId: string;
  detail: string;
  recommendation: string;
}

interface PolicyModuleCheckEntry {
  status: 'ok' | 'error';
  project: string;
  module: string;
  ruleId: string;
  file?: string;
  line?: number;
  detail?: string;
  recommendation?: string;
}

interface PolicyImportViolation {
  project: string;
  module: string;
  file: string;
  line: number;
  ruleId: string;
  detail: string;
  recommendation: string;
}

interface PolicyRuleReport {
  project: string;
  ruleId: string;
  kind: 'folder' | 'import' | 'lockfile' | 'ast';
  scope: string;
  status: 'ok' | 'error';
  modules: PolicyModuleCheckEntry[];
  violations: PolicyImportViolation[];
  recommendation?: string;
}

interface ProjectFolderDefinition {
  name: string;
  definition: string;
}

interface ProjectFolderRule {
  type: 'folder';
  id: string;
  baseFolder: string;
  allowedFolders: ProjectFolderDefinition[];
  recommendation: string;
}

interface ProjectImportRule {
  type: 'import';
  id: string;
  baseFolder: string;
  allowedFolders: string[];
  allowedFiles?: string[];
  moduleSpecifier: string;
  recommendation: string;
}

interface AstPolicyRule {
  id: string;
  kind: 'ast';
  recommendation: string;
  check: (ast: File, file: string, violations: PolicyImportViolation[]) => void;
}

interface RootLockfileRule {
  type: 'lockfile';
  id: string;
  lockfilePath: string;
  recommendation: string;
}

interface RootPolicies {
  name: string;
  lockfiles: RootLockfileRule[];
}

interface ProjectPolicies {
  name: string;
  path: string;
  folders: ProjectFolderRule[];
  imports: ProjectImportRule[];
}

const ANSI_RESET = '\u001b[0m';
const ANSI_GREEN = '\u001b[32m';
const ANSI_RED = '\u001b[31m';

function colorize(text: string, color: string): string {
  return `${color}${text}${ANSI_RESET}`;
}

function formatCheckEntry(entry: PolicyCheckEntry): string {
  const statusLabel = entry.status === 'ok' ? 'OK' : 'Error';
  const coloredStatusLabel = colorize(statusLabel, entry.status === 'ok' ? ANSI_GREEN : ANSI_RED);
  const baseMessage = `  ${coloredStatusLabel} ${entry.project}/${entry.module}/${entry.folder} (${entry.file}:${entry.line}) [${entry.ruleId}]`;

  if (entry.status === 'ok') {
    return baseMessage;
  }

  return `${baseMessage} — ${entry.detail} — ${entry.recommendation}`;
}

function formatModuleCheckEntry(entry: PolicyModuleCheckEntry): string {
  const statusLabel = entry.status === 'ok' ? 'OK' : 'Error';
  const coloredStatusLabel = colorize(statusLabel, entry.status === 'ok' ? ANSI_GREEN : ANSI_RED);
  const location = entry.file ? ` (${entry.file}${entry.line ? `:${entry.line}` : ''})` : '';
  const baseMessage = `  ${coloredStatusLabel} ${entry.project}/${entry.module}${location}`;

  if (entry.status === 'ok') {
    return baseMessage;
  }

  const detail = entry.detail ? ` — ${entry.detail}` : '';
  const recommendation = entry.recommendation ? ` — ${entry.recommendation}` : '';

  return `${baseMessage}${detail}${recommendation}`;
}

function formatImportViolation(entry: PolicyImportViolation): string {
  return `  ${colorize('Error', ANSI_RED)} ${entry.project}/${entry.module} (${entry.file}:${entry.line}) [${entry.ruleId}] — ${entry.detail} — ${entry.recommendation}`;
}

function formatRuleReportHeader(report: PolicyRuleReport): string {
  return `Rule: ${report.ruleId} (${report.kind}) - scope: ${report.scope}`;
}

function formatRuleReportFooter(report: PolicyRuleReport): string {
  return report.status === 'ok' ? 'Rule OK' : `Rule Error — ${report.recommendation ?? 'fix violations'}`;
}

export type {
  AstPolicyRule,
  PolicyCheckEntry,
  PolicyModuleCheckEntry,
  PolicyImportViolation,
  PolicyRuleReport,
  ProjectFolderDefinition,
  ProjectFolderRule,
  ProjectImportRule,
  ProjectPolicies,
  RootLockfileRule,
  RootPolicies,
};
export {
  formatCheckEntry,
  formatImportViolation,
  formatModuleCheckEntry,
  formatRuleReportFooter,
  formatRuleReportHeader,
};
