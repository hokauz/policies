import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

import type { LoadedPolicyCatalog } from './types';

interface ImportFact {
  kind: 'import';
  file: string;
  line: number;
  source: string;
  localNames: string[];
}

interface CallFact {
  kind: 'call';
  file: string;
  line: number;
  calleeType: 'identifier' | 'member' | 'other';
  functionName?: string;
  object?: string;
  property?: string;
  firstArgumentType?: string;
  firstArgumentValue?: string;
  argumentCount: number;
}

interface MemberExpressionFact {
  kind: 'member-expression';
  file: string;
  line: number;
  object: string;
  property: string;
}

interface ObjectPropertyFact {
  kind: 'object-property';
  file: string;
  line: number;
  keyName: string;
  numericValue?: number;
}

interface TsSyntaxFact {
  kind: 'ts-syntax';
  file: string;
  line: number;
  nodeType: string;
}

interface ExportFact {
  kind: 'export';
  file: string;
  line: number;
  hasDeclaration: boolean;
  declarationType?: string;
  isDefault: boolean;
  isReExport: boolean;
}

interface FileSummaryFact {
  kind: 'file-summary';
  file: string;
  importLocalNames: string[];
  importSources: string[];
}

interface CatalogFacts {
  files: string[];
  imports: ImportFact[];
  calls: CallFact[];
  memberExpressions: MemberExpressionFact[];
  objectProperties: ObjectPropertyFact[];
  tsSyntax: TsSyntaxFact[];
  exports: ExportFact[];
  fileSummaries: FileSummaryFact[];
}

function toRepoRelativePath(repoRoot: string, absolutePath: string): string {
  return absolutePath.startsWith(repoRoot) ? absolutePath.slice(repoRoot.length + 1) : absolutePath;
}

function shouldScanFile(relativePath: string, catalog: LoadedPolicyCatalog): boolean {
  if (catalog.scan.ignorePathParts.some((part) => relativePath.includes(part))) {
    return false;
  }

  return relativePath.endsWith('.ts') || relativePath.endsWith('.tsx');
}

async function collectSourceFiles(repoRoot: string, catalog: LoadedPolicyCatalog): Promise<string[]> {
  const files: string[] = [];

  for (const root of catalog.scan.roots) {
    for (const pattern of catalog.scan.patterns) {
      const glob = new Bun.Glob(pattern);

      for await (const match of glob.scan({
        cwd: resolve(repoRoot, root),
        absolute: true,
        onlyFiles: true,
      })) {
        const rel = toRepoRelativePath(repoRoot, match);

        if (shouldScanFile(rel, catalog)) {
          files.push(match);
        }
      }
    }
  }

  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

function getStringLiteralValue(node: { type: string; value?: unknown } | undefined): string | undefined {
  return node?.type === 'StringLiteral' && typeof node.value === 'string' ? node.value : undefined;
}

function collectAstFactsForFile(repoRoot: string, absoluteFile: string): Omit<CatalogFacts, 'files'> {
  const file = toRepoRelativePath(repoRoot, absoluteFile);
  const ast = parse(readFileSync(absoluteFile, 'utf8'), {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
    errorRecovery: true,
  });
  const imports: ImportFact[] = [];
  const calls: CallFact[] = [];
  const memberExpressions: MemberExpressionFact[] = [];
  const objectProperties: ObjectPropertyFact[] = [];
  const tsSyntax: TsSyntaxFact[] = [];
  const exports: ExportFact[] = [];

  traverse(ast, {
    ImportDeclaration(path) {
      imports.push({
        kind: 'import',
        file,
        line: path.node.loc?.start.line ?? 1,
        source: path.node.source.value,
        localNames: path.node.specifiers.map((specifier) => specifier.local.name),
      });
    },
    TSImportType(path) {
      const source = getStringLiteralValue(path.node.argument);
      if (!source) return;

      imports.push({
        kind: 'import',
        file,
        line: path.node.loc?.start.line ?? 1,
        source,
        localNames: [],
      });
    },
    CallExpression(path) {
      const callee = path.node.callee;
      const firstArgument = path.node.arguments[0];
      const firstArgumentType = firstArgument?.type;
      const firstArgumentValue = getStringLiteralValue(firstArgument as { type: string; value?: unknown } | undefined);

      if (callee.type === 'Identifier') {
        calls.push({
          kind: 'call',
          file,
          line: path.node.loc?.start.line ?? 0,
          calleeType: 'identifier',
          functionName: callee.name,
          firstArgumentType,
          firstArgumentValue,
          argumentCount: path.node.arguments.length,
        });
        return;
      }

      if (callee.type === 'MemberExpression') {
        calls.push({
          kind: 'call',
          file,
          line: path.node.loc?.start.line ?? 0,
          calleeType: 'member',
          object: callee.object.type === 'Identifier' ? callee.object.name : undefined,
          property: callee.property.type === 'Identifier' ? callee.property.name : undefined,
          firstArgumentType,
          firstArgumentValue,
          argumentCount: path.node.arguments.length,
        });
        return;
      }

      calls.push({
        kind: 'call',
        file,
        line: path.node.loc?.start.line ?? 0,
        calleeType: 'other',
        firstArgumentType,
        firstArgumentValue,
        argumentCount: path.node.arguments.length,
      });
    },
    MemberExpression(path) {
      const object = path.node.object;
      const property = path.node.property;
      if (object.type !== 'Identifier' || property.type !== 'Identifier') return;

      memberExpressions.push({
        kind: 'member-expression',
        file,
        line: path.node.loc?.start.line ?? 0,
        object: object.name,
        property: property.name,
      });
    },
    ObjectProperty(path) {
      const key = path.node.key;
      const value = path.node.value;
      const keyName = key.type === 'Identifier' ? key.name : key.type === 'StringLiteral' ? key.value : undefined;
      if (!keyName) return;

      objectProperties.push({
        kind: 'object-property',
        file,
        line: path.node.loc?.start.line ?? 0,
        keyName,
        numericValue: value.type === 'NumericLiteral' ? value.value : undefined,
      });
    },
    TSAnyKeyword(path) {
      tsSyntax.push({
        kind: 'ts-syntax',
        file,
        line: path.node.loc?.start.line ?? 0,
        nodeType: 'TSAnyKeyword',
      });
    },
    ExportNamedDeclaration(path) {
      exports.push({
        kind: 'export',
        file,
        line: path.node.loc?.start.line ?? 0,
        hasDeclaration: Boolean(path.node.declaration),
        declarationType: path.node.declaration?.type,
        isDefault: false,
        isReExport: Boolean(path.node.source),
      });
    },
    ExportDefaultDeclaration(path) {
      exports.push({
        kind: 'export',
        file,
        line: path.node.loc?.start.line ?? 0,
        hasDeclaration: true,
        declarationType: path.node.declaration.type,
        isDefault: true,
        isReExport: false,
      });
    },
  });

  return {
    imports,
    calls,
    memberExpressions,
    objectProperties,
    tsSyntax,
    exports,
    fileSummaries: [
      {
        kind: 'file-summary',
        file,
        importLocalNames: [...new Set(imports.flatMap((entry) => entry.localNames))],
        importSources: [...new Set(imports.map((entry) => entry.source))],
      },
    ],
  };
}

async function collectCatalogFacts(repoRoot: string, catalog: LoadedPolicyCatalog): Promise<CatalogFacts> {
  const absoluteFiles = await collectSourceFiles(repoRoot, catalog);
  const facts: CatalogFacts = {
    files: absoluteFiles.map((file) => toRepoRelativePath(repoRoot, file)),
    imports: [],
    calls: [],
    memberExpressions: [],
    objectProperties: [],
    tsSyntax: [],
    exports: [],
    fileSummaries: [],
  };

  for (const absoluteFile of absoluteFiles) {
    try {
      const fileFacts = collectAstFactsForFile(repoRoot, absoluteFile);
      facts.imports.push(...fileFacts.imports);
      facts.calls.push(...fileFacts.calls);
      facts.memberExpressions.push(...fileFacts.memberExpressions);
      facts.objectProperties.push(...fileFacts.objectProperties);
      facts.tsSyntax.push(...fileFacts.tsSyntax);
      facts.exports.push(...fileFacts.exports);
      facts.fileSummaries.push(...fileFacts.fileSummaries);
    } catch {
      continue;
    }
  }

  return facts;
}

export type {
  CallFact,
  CatalogFacts,
  ExportFact,
  FileSummaryFact,
  ImportFact,
  MemberExpressionFact,
  ObjectPropertyFact,
  TsSyntaxFact,
};
export { collectCatalogFacts, collectSourceFiles };
