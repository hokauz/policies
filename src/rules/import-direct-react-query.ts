import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

import type {
  PolicyImportViolation,
  ProjectImportRule,
  ProjectPolicies,
} from '../types';

const TEST_FILE_PATTERN = /(^|\/)__tests__\/|\.test\.[jt]sx?$|\.spec\.[jt]sx?$/;

function toRepoRelativePath(repoRoot: string, absolutePath: string): string {
  return absolutePath.startsWith(repoRoot) ? absolutePath.slice(repoRoot.length + 1) : absolutePath;
}

function getModuleName(baseFolderPath: string, absoluteFile: string): string {
  const relativePath = absoluteFile.slice(baseFolderPath.length + 1);
  const [firstSegment] = relativePath.split('/');

  return firstSegment ?? 'root';
}

function isAllowedFile(repoRelativeFile: string, projectPath: string, allowedFiles: string[] | undefined): boolean {
  if (!allowedFiles || allowedFiles.length === 0) {
    return false;
  }

  const projectRelativeFile = repoRelativeFile.startsWith(`${projectPath}/`)
    ? repoRelativeFile.slice(projectPath.length + 1)
    : repoRelativeFile;

  return allowedFiles.includes(projectRelativeFile);
}

function isUnderAllowedFolder(absoluteFile: string, allowedRoots: string[]): boolean {
  return allowedRoots.some((root) => absoluteFile === root || absoluteFile.startsWith(`${root}/`));
}

function formatImportViolationDetail(rule: ProjectImportRule): string {
  const allowedLocations = [...rule.allowedFolders, ...(rule.allowedFiles ?? [])].join(', ');

  return `direct import of "${rule.moduleSpecifier}" outside ${allowedLocations}`;
}

async function collectSourceFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob('**/*.{ts,tsx}');

  for await (const match of glob.scan({
    cwd: rootPath,
    absolute: true,
    onlyFiles: true,
  })) {
    files.push(match);
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function findDirectReactQueryImportLine(code: string, moduleSpecifier: string): number | undefined {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
    errorRecovery: true,
  });

  let line: number | undefined;

  traverse(ast, {
    ImportDeclaration(path: any) {
      if (path.node.source.value !== moduleSpecifier) {
        return;
      }

      line = path.node.loc?.start.line ?? 1;
      path.stop();
    },
    TSImportType(path: any) {
      const argument = path.node.argument;

      if (argument.type !== 'StringLiteral' || argument.value !== moduleSpecifier) {
        return;
      }

      line = path.node.loc?.start.line ?? 1;
      path.stop();
    },
  });

  return line;
}

async function checkProjectImportRule(
  repoRoot: string,
  project: ProjectPolicies,
  rule: ProjectImportRule,
): Promise<PolicyImportViolation[]> {
  const violations: PolicyImportViolation[] = [];
  const baseFolderPath = resolve(repoRoot, project.path, rule.baseFolder);

  if (!existsSync(baseFolderPath)) {
    violations.push({
      project: project.name,
      module: rule.baseFolder,
      file: toRepoRelativePath(repoRoot, baseFolderPath),
      line: 1,
      ruleId: rule.id,
      detail: `missing base folder "${rule.baseFolder}"`,
      recommendation: rule.recommendation,
    });
    return violations;
  }

  const allowedRoots = rule.allowedFolders.map((folder) =>
    resolve(repoRoot, project.path, rule.baseFolder, folder),
  );

  const files = await collectSourceFiles(baseFolderPath);

  for (const absoluteFile of files) {
    const repoRelativeFile = toRepoRelativePath(repoRoot, absoluteFile);

    if (TEST_FILE_PATTERN.test(repoRelativeFile)) {
      continue;
    }

    if (isUnderAllowedFolder(absoluteFile, allowedRoots)) {
      continue;
    }

    if (isAllowedFile(repoRelativeFile, project.path, rule.allowedFiles)) {
      continue;
    }

    const code = readFileSync(absoluteFile, 'utf8');
    const line = findDirectReactQueryImportLine(code, rule.moduleSpecifier);

    if (!line) {
      continue;
    }

    violations.push({
      project: project.name,
      module: getModuleName(baseFolderPath, absoluteFile),
      file: repoRelativeFile,
      line,
      ruleId: rule.id,
      detail: formatImportViolationDetail(rule),
      recommendation: rule.recommendation,
    });
  }

  return violations;
}

export { checkProjectImportRule };
