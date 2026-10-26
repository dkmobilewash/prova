/**
 * WHAT A SURFACE CALLS, AND HOW IT IS RENDERED — the two things
 * `navTargets.ts` cannot see because neither is a link.
 *
 * FOR TESTS ONLY (`typescript` is a devDependency). Used by
 * `bidLinkCensus.test.ts`:
 *
 *   - `importedBindings` + `exportedFunctionSource`: which Server Actions a
 *     surface's files import, and the text of each, so the census can read the
 *     `redirect()` calls INSIDE them. The link census's sight ends at `lib/`
 *     (`createJob` ends in a redirect it could never see), and a Bid screen
 *     that calls an action that redirects into the CRM is exactly as broken as
 *     one that draws the link.
 *   - `jsxElements`: every JSX element in a file with its string-literal props,
 *     so the census can require that a shared component which takes a `surface`
 *     (or `returnTo`) is RENDERED with the Bid value. A Bid page that renders
 *     the CRM's takeoff without `surface="bid"` draws CRM links through a
 *     `hrefs.x` sink the literal reader cannot resolve.
 */
import ts from "typescript";

const kindOf = (fileName: string) => (fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const parse = (source: string, fileName: string) =>
  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kindOf(fileName));

/** One imported binding: the local name, the name it has in the module it
 * comes from, and the specifier it was imported from. Type-only imports are
 * skipped — they carry no runtime code. */
export type ImportedBinding = { local: string; imported: string; specifier: string };

export function importedBindings(source: string, fileName: string): ImportedBinding[] {
  const file = parse(source, fileName);
  const out: ImportedBinding[] = [];
  for (const node of file.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const clause = node.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const specifier = node.moduleSpecifier.text;
    if (clause.name) out.push({ local: clause.name.text, imported: "default", specifier });
    const named = clause.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        if (el.isTypeOnly) continue;
        out.push({ local: el.name.text, imported: (el.propertyName ?? el.name).text, specifier });
      }
    }
  }
  return out;
}

/** Every exported top-level function (or const) in a file, name -> source text
 * (the default export under `"default"`). Parsed once, so a census can look up
 * dozens of names without re-parsing the file for each. */
export function exportedFunctionSources(source: string, fileName: string): Map<string, string> {
  const file = parse(source, fileName);
  const out = new Map<string, string>();
  for (const node of file.statements) {
    const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
    if (!modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(node)) {
      if (modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) out.set("default", node.getText(file));
      if (node.name) out.set(node.name.text, node.getText(file));
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) out.set(decl.name.text, node.getText(file));
      }
    }
  }
  return out;
}

/** One of those, or null. */
export function exportedFunctionSource(source: string, fileName: string, name: string): string | null {
  return exportedFunctionSources(source, fileName).get(name) ?? null;
}

export type JsxUse = { tag: string; line: number; props: Record<string, string | true> };

/** Every JSX element in a file, with each attribute's string-literal value
 * (`surface="bid"` -> `{ surface: "bid" }`); any other attribute value is
 * recorded as `true`, i.e. "present, not readable". */
export function jsxElements(source: string, fileName: string): JsxUse[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: JsxUse[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const props: Record<string, string | true> = {};
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr)) continue;
        const name = attr.name.getText(file);
        const init = attr.initializer;
        if (!init) props[name] = true;
        else if (ts.isStringLiteral(init)) props[name] = init.text;
        else if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression)) {
          props[name] = init.expression.text;
        } else props[name] = true;
      }
      out.push({ tag: node.tagName.getText(file), line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, props });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}
