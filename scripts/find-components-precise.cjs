// scripts/find-components-precise.cjs
// Uso:
//   npm i -D ts-morph fast-glob typescript
//   node scripts/find-components-precise.cjs .
// Salida:
//   - components-report.precise.json
//   - resumen limpio en consola

const path = require('node:path');
const fs = require('node:fs');
const fg = require('fast-glob');
const { Project, SyntaxKind } = require('ts-morph');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const REPORT_PATH = path.join(ROOT, 'components-report.precise.json');

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function isPascalCase(name) {
  return /^[A-Z][A-Za-z0-9_]*$/.test(name || '');
}

function hasJsx(node) {
  return node.getDescendants().some((d) => {
    const k = d.getKind();
    return (
      k === SyntaxKind.JsxElement ||
      k === SyntaxKind.JsxSelfClosingElement ||
      k === SyntaxKind.JsxFragment
    );
  });
}

function pushUnique(arr, value) {
  if (!arr.includes(value)) arr.push(value);
}

function ensureAgg(map, name) {
  if (!map.has(name)) {
    map.set(name, {
      name,
      declaredIn: [],
      importedFrom: [],
      usedIn: [],
      usageCount: 0,
      unresolved: false,
    });
  }
  return map.get(name);
}

function unwrapFunctionLike(initializer) {
  if (!initializer) return null;

  const kind = initializer.getKind();

  if (
    kind === SyntaxKind.ArrowFunction ||
    kind === SyntaxKind.FunctionExpression
  ) {
    return initializer;
  }

  if (kind === SyntaxKind.CallExpression) {
    const exprText = initializer.getExpression().getText();
    // memo(...), React.memo(...), forwardRef(...), React.forwardRef(...)
    if (/(^|\.)(memo|forwardRef)$/.test(exprText)) {
      for (const arg of initializer.getArguments()) {
        const inner = unwrapFunctionLike(arg);
        if (inner) return inner;
      }
    }
  }

  return null;
}

const tsconfigPath = path.join(ROOT, 'tsconfig.json');
const project = new Project({
  ...(fs.existsSync(tsconfigPath) ? { tsConfigFilePath: tsconfigPath } : {}),
  skipAddingFilesFromTsConfig: true,
});

const files = fg.sync(['**/*.{tsx,jsx}'], {
  cwd: ROOT,
  absolute: true,
  onlyFiles: true,
  ignore: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/coverage/**',
    '**/.turbo/**',
  ],
});

if (!files.length) {
  console.error('No encontré archivos .tsx o .jsx');
  process.exit(1);
}

for (const file of files) {
  project.addSourceFileAtPath(file);
}

const aggregate = new Map();
const perFile = [];

for (const sourceFile of project.getSourceFiles()) {
  const filePath = rel(sourceFile.getFilePath());

  const importedUppercase = [];
  const localComponents = [];
  const usedSimpleTagsCount = new Map();
  const namespacedJsxTagsCount = new Map();

  // 1) Imports uppercase, pero filtrando type-only
  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.isTypeOnly && imp.isTypeOnly()) continue;

    const importSource = imp.getModuleSpecifierValue();

    const defaultImport = imp.getDefaultImport();
    if (defaultImport) {
      const name = defaultImport.getText().trim();
      if (isPascalCase(name)) {
        importedUppercase.push({
          name,
          source: importSource,
          kind: 'default',
        });
      }
    }

    for (const named of imp.getNamedImports()) {
      if (named.isTypeOnly && named.isTypeOnly()) continue;

      const alias = named.getAliasNode()?.getText()?.trim();
      const original = named.getNameNode()?.getText()?.trim();
      const name = alias || original;

      if (isPascalCase(name)) {
        importedUppercase.push({
          name,
          source: importSource,
          kind: alias ? 'named-aliased' : 'named',
          importedAs: original,
        });
      }
    }
  }

  // 2) Declaraciones locales que realmente renderizan JSX
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (isPascalCase(name) && hasJsx(fn)) {
      localComponents.push({
        name,
        kind: 'function',
        exported: fn.isExported(),
      });
    }
  }

  for (const vd of sourceFile.getVariableDeclarations()) {
    const name = vd.getName();
    if (!isPascalCase(name)) continue;

    const fnLike = unwrapFunctionLike(vd.getInitializer());
    if (fnLike && hasJsx(fnLike)) {
      const stmt = vd.getVariableStatement();
      localComponents.push({
        name,
        kind: 'variable',
        exported: stmt?.isExported?.() || false,
      });
    }
  }

  // 3) JSX usado
  const jsxNodes = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  for (const el of jsxNodes) {
    const rawTag = el.getTagNameNode().getText().trim();

    // Ej: React.StrictMode, Dialog.Root
    if (rawTag.includes('.')) {
      namespacedJsxTagsCount.set(
        rawTag,
        (namespacedJsxTagsCount.get(rawTag) || 0) + 1
      );
      continue;
    }

    if (isPascalCase(rawTag)) {
      usedSimpleTagsCount.set(rawTag, (usedSimpleTagsCount.get(rawTag) || 0) + 1);
    }
  }

  const usedComponents = Array.from(usedSimpleTagsCount.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const namespacedJsxTags = Array.from(namespacedJsxTagsCount.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const importedNames = new Set(importedUppercase.map((x) => x.name));
  const localNames = new Set(localComponents.map((x) => x.name));
  const usedNames = new Set(usedComponents.map((x) => x.name));

  // Solo consideramos "componentes importados" los uppercase que sí se usan en JSX
  const importedComponentsUsedAsJsx = importedUppercase.filter((c) =>
    usedNames.has(c.name)
  );

  // Uppercase importados pero NO usados como JSX => ruido o utilidades
  const uppercaseImportsNotUsedAsJsx = importedUppercase.filter(
    (c) => !usedNames.has(c.name)
  );

  // Usados en JSX pero no detectados como local ni importado
  const unresolvedUsedComponents = usedComponents.filter(
    (c) => !importedNames.has(c.name) && !localNames.has(c.name)
  );

  // Agregado global
  for (const c of localComponents) {
    const entry = ensureAgg(aggregate, c.name);
    pushUnique(entry.declaredIn, filePath);
  }

  for (const c of importedComponentsUsedAsJsx) {
    const entry = ensureAgg(aggregate, c.name);
    pushUnique(entry.importedFrom, c.source);
    pushUnique(entry.usedIn, filePath);
  }

  for (const c of usedComponents) {
    const entry = ensureAgg(aggregate, c.name);
    pushUnique(entry.usedIn, filePath);
    entry.usageCount += c.count;
  }

  for (const c of unresolvedUsedComponents) {
    const entry = ensureAgg(aggregate, c.name);
    entry.unresolved = true;
  }

  perFile.push({
    file: filePath,
    localComponents,
    usedComponents,
    importedComponentsUsedAsJsx,
    unresolvedUsedComponents,
    uppercaseImportsNotUsedAsJsx,
    namespacedJsxTags,
  });
}

const components = Array.from(aggregate.values()).sort((a, b) =>
  a.name.localeCompare(b.name)
);

const unresolved = components.filter((c) => c.unresolved);
const declared = components.filter((c) => c.declaredIn.length > 0);
const importedOnly = components.filter(
  (c) => c.declaredIn.length === 0 && c.importedFrom.length > 0
);

const report = {
  root: ROOT,
  scannedFiles: files.map(rel).sort(),
  totals: {
    files: files.length,
    components: components.length,
    declaredComponents: declared.length,
    importedOnlyComponents: importedOnly.length,
    unresolvedComponents: unresolved.length,
  },
  components,
  perFile: perFile.sort((a, b) => a.file.localeCompare(b.file)),
};

fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

// Consola
console.log('\n=== COMPONENTES REALES DETECTADOS ===\n');
for (const comp of components) {
  console.log(
    `- ${comp.name}\n` +
    `  usos JSX: ${comp.usageCount}\n` +
    `  declarado en: ${comp.declaredIn.join(', ') || '-'}\n` +
    `  importado desde: ${comp.importedFrom.join(', ') || '-'}\n` +
    `  usado en: ${comp.usedIn.join(', ') || '-'}\n` +
    `  no resuelto: ${comp.unresolved ? 'sí' : 'no'}\n`
  );
}

console.log('\n=== RESUMEN ===\n');
console.log(`Archivos escaneados: ${report.totals.files}`);
console.log(`Componentes totales: ${report.totals.components}`);
console.log(`Declarados localmente: ${report.totals.declaredComponents}`);
console.log(`Solo importados/consumidos: ${report.totals.importedOnlyComponents}`);
console.log(`No resueltos: ${report.totals.unresolvedComponents}`);
console.log(`\nReporte guardado en: ${REPORT_PATH}`);