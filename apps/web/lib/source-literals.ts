/**
 * The strings a source file actually carries — every string literal,
 * template literal and piece of JSX text — read through the TypeScript
 * parser rather than a regex.
 *
 * FOR TESTS ONLY (the censuses that import it: routeInboundLinks.test.ts and
 * usSpellingCensus.test.ts). Nothing in the app imports it, so it never
 * reaches a bundle; `typescript` is a devDependency.
 *
 * WHY A PARSER, and it is the whole point of this file. Every census here
 * that scans source for a string has to decide what a COMMENT is, and CLAUDE.md
 * records a census disarmed by a comment quoting its own pattern (#185). A
 * regex comment-stripper also has to understand JSX text, where `don't` opens
 * a "string" that never closes and `http://` opens a "comment" that eats the
 * rest of the line. The parser already knows all of that, and comments are
 * simply not nodes: nothing returned here can come from one.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export type SourceLiteral = {
  /** A template literal's `${…}` holes are each written as `${}`. */
  text: string;
  kind: "string" | "template" | "jsx-text";
  /** The name of the call this literal is an argument to, if any —
   * `revalidatePath`, `redirect`, `push` — searched up to four parents out. */
  call: string | null;
};

function enclosingCall(node: ts.Node): string | null {
  let parent: ts.Node | undefined = node.parent;
  for (let depth = 0; depth < 4 && parent; depth++, parent = parent.parent) {
    if (ts.isCallExpression(parent)) {
      const callee = parent.expression;
      if (ts.isIdentifier(callee)) return callee.text;
      if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
      return null;
    }
  }
  return null;
}

export function sourceLiterals(source: string, fileName: string): SourceLiteral[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: SourceLiteral[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push({ text: node.text, kind: "string", call: enclosingCall(node) });
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const text = node.head.text + node.templateSpans.map((span) => "${}" + span.literal.text).join("");
      out.push({ text, kind: "template", call: enclosingCall(node) });
      // The holes can hold literals of their own.
      node.templateSpans.forEach((span) => visit(span.expression));
      return;
    }
    if (ts.isJsxText(node)) {
      if (node.text.trim()) out.push({ text: node.text, kind: "jsx-text", call: null });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/** Every non-test .ts/.tsx file under `dir`, as absolute paths. */
export function appSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...appSourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|dbtest|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out;
}

export function fileLiterals(path: string): SourceLiteral[] {
  return sourceLiterals(readFileSync(path, "utf8"), path);
}
