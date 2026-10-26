/**
 * WHERE A SOURCE FILE CAN SEND A BROWSER — every navigation target it writes,
 * read through the TypeScript parser, plus the import closure that decides
 * which files a surface actually renders.
 *
 * FOR TESTS ONLY (`typescript` is a devDependency); nothing in the app imports
 * it. Used by `bidLinkCensus.test.ts`, and written as a module rather than
 * inside that test so the next wave can point it at a CRM page it is about to
 * port and get the exact list of hrefs that would leak (see the porting brief
 * in the changelog entry).
 *
 * A SINK is a place a string becomes a URL somebody is taken to:
 *   - a JSX `href` attribute (`<Link href>`, `<a href>`);
 *   - an object property named `href` (`{ label, href }` — nav tables,
 *     EmptyState actions);
 *   - the first argument of `redirect`, `permanentRedirect`, `push`,
 *     `replace`, `prefetch` (`router.push`, `redirect` from next/navigation);
 *   - an assignment to a property named `href` (`window.location.href = …`)
 *     and the argument of `location.assign`.
 * Comments are not nodes, so a commented-out link can never count (#185).
 *
 * Every literal inside a sink's expression is collected — both arms of a
 * conditional, each string in a `??` — and the template holes are written
 * `${}`. A sink with NO literal anywhere in its expression (`href={item.href}`)
 * is reported as DYNAMIC: the census cannot read where it goes, so it must be
 * named on an allowlist with the reason it is safe, rather than assumed safe.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

export type NavTarget = {
  file: string;
  line: number;
  /** The literal, holes as `${}`; for a dynamic sink, the expression's text. */
  text: string;
  dynamic: boolean;
  sink: "jsx-href" | "prop-href" | "call" | "assign-href";
};

const NAV_CALLS = new Set(["redirect", "permanentRedirect", "push", "replace", "prefetch", "assign"]);

function literalsIn(node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      out.push(n.text);
      return;
    }
    if (ts.isTemplateExpression(n)) {
      out.push(n.head.text + n.templateSpans.map((s) => "${}" + s.literal.text).join(""));
      return;
    }
    // A call inside the expression (`encodeURIComponent(x)`, `fn("/x")`) is a
    // computed value; its own string arguments are not where the link goes.
    if (ts.isCallExpression(n)) return;
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

export function navTargetsInSource(source: string, fileName: string): NavTarget[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: NavTarget[] = [];
  const record = (expr: ts.Node, sink: NavTarget["sink"]) => {
    const line = file.getLineAndCharacterOfPosition(expr.getStart(file)).line + 1;
    const literals = literalsIn(expr);
    if (literals.length === 0) {
      out.push({ file: fileName, line, text: expr.getText(file), dynamic: true, sink });
    } else {
      for (const text of literals) out.push({ file: fileName, line, text, dynamic: false, sink });
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === "href" && node.initializer) {
      const init = node.initializer;
      record(ts.isJsxExpression(init) && init.expression ? init.expression : init, "jsx-href");
    } else if (ts.isPropertyAssignment(node) && node.name.getText(file) === "href") {
      record(node.initializer, "prop-href");
    } else if (
      ts.isShorthandPropertyAssignment(node) &&
      node.name.text === "href" &&
      // `{ href }` inside an object LITERAL is a value being passed on; a
      // destructuring pattern is not an object literal, so it never gets here.
      ts.isObjectLiteralExpression(node.parent)
    ) {
      record(node.name, "prop-href");
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression;
      // `redirect("/x")` bare; `router.push("/x")` and `location.assign("/x")`
      // only on something NAMED like a router or a location — `rows.push(row)`
      // and `text.replace(a, b)` are not navigation, and reading them as such
      // would bury the real sinks under noise on the dynamic allowlist.
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) &&
            (/router$/i.test(callee.expression.getText(file))
              ? ["push", "replace", "prefetch"].includes(callee.name.text)
              : /location$/i.test(callee.expression.getText(file)) && callee.name.text === "assign")
          ? callee.name.text
          : null;
      if (name && NAV_CALLS.has(name) && (ts.isPropertyAccessExpression(callee) || name.endsWith("edirect"))) {
        record(node.arguments[0], "call");
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === "href"
    ) {
      record(node.right, "assign-href");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

export function navTargetsInFile(path: string): NavTarget[] {
  return navTargetsInSource(readFileSync(path, "utf8"), path);
}

/** Every module specifier a file imports or re-exports, static or dynamic. */
export function importSpecifiers(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)) {
      // A type-only import carries no runtime code and renders nothing.
      const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
      if (!typeOnly) out.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/** `@/x` and relative specifiers resolved against the web app root; package
 * imports return null. */
export function resolveImport(specifier: string, fromFile: string, webRoot: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(webRoot, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return null;
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * The files reachable from `entries` by following imports, but only INTO the
 * directories named by `follow` (absolute paths). Everything outside them is
 * recorded in `stoppedAt` rather than walked, so a census can say out loud
 * where its sight ends instead of letting the boundary be silent.
 */
export function importClosure(
  entries: readonly string[],
  webRoot: string,
  follow: readonly string[],
): { files: string[]; stoppedAt: string[] } {
  const seen = new Set<string>();
  const stopped = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importSpecifiers(readFileSync(file, "utf8"), file)) {
      const target = resolveImport(spec, file, webRoot);
      if (!target) continue;
      if (follow.some((dir) => target.startsWith(dir + "/"))) queue.push(target);
      else stopped.add(target);
    }
  }
  return { files: [...seen].sort(), stoppedAt: [...stopped].sort() };
}
