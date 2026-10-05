import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.resolve(rootDir, 'src');

function getFiles(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

const allFiles = getFiles(srcDir);
const testFiles = allFiles.filter(f => f.includes('.test.') || f.includes('.spec.'));
// Exclude main.tsx (entrypoint with immediate side-effects which cannot be imported in tests)
const prodFiles = allFiles.filter(f => !f.includes('.test.') && !f.includes('.spec.') && !f.endsWith('main.tsx'));

// Collect exported symbols from production files
const exportedSymbols = new Map(); // name -> Set of file paths
for (const file of prodFiles) {
  const code = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  ts.forEachChild(sf, (node) => {
    const isExported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (isExported) {
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const name = decl.name.text;
            if (!exportedSymbols.has(name)) exportedSymbols.set(name, new Set());
            exportedSymbols.get(name).add(path.relative(rootDir, file));
          }
        }
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        const name = node.name.text;
        if (!exportedSymbols.has(name)) exportedSymbols.set(name, new Set());
        exportedSymbols.get(name).add(path.relative(rootDir, file));
      } else if (ts.isClassDeclaration(node) && node.name) {
        const name = node.name.text;
        if (!exportedSymbols.has(name)) exportedSymbols.set(name, new Set());
        exportedSymbols.get(name).add(path.relative(rootDir, file));
      }
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const name = element.name.text;
        if (!exportedSymbols.has(name)) exportedSymbols.set(name, new Set());
        exportedSymbols.get(name).add(path.relative(rootDir, file));
      }
    }
  });
}

const violations = [];

for (const file of testFiles) {
  const relPath = path.relative(rootDir, file);
  const code = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const importedNames = new Set();
  const declaredNames = []; // { name, line }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      if (node.importClause) {
        if (node.importClause.name) importedNames.add(node.importClause.name.text);
        if (node.importClause.namedBindings) {
          if (ts.isNamedImports(node.importClause.namedBindings)) {
            for (const el of node.importClause.namedBindings.elements) {
              importedNames.add(el.name.text);
            }
          } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
            importedNames.add(node.importClause.namedBindings.name.text);
          }
        }
      }
      return;
    }

    // Check variable declarations that have an initializer (re-defined constants/values)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      declaredNames.push({ name, line: line + 1 });
    } else if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const name = node.name.text;
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      declaredNames.push({ name, line: line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  for (const { name, line } of declaredNames) {
    if (exportedSymbols.has(name) && !importedNames.has(name)) {
      violations.push({
        file: relPath,
        line,
        name,
        exportedIn: Array.from(exportedSymbols.get(name)),
      });
    }
  }
}

if (violations.length > 0) {
  console.error(`Found ${violations.length} shadowed symbol declaration(s) across test files:`);
  for (const v of violations) {
    console.error(`  - ${v.file}:${v.line}: '${v.name}' (exported in ${v.exportedIn.join(', ')})`);
  }
  process.exit(1);
} else {
  console.log('No shadowed symbols found across test files.');
  process.exit(0);
}
