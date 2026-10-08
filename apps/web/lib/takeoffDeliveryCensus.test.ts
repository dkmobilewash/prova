/**
 * THE FREE DRAWING-SET READ'S EMAIL — IS IT CALLED, AND IS IT STILL PURE.
 *
 * `lib/takeoff-delivery.ts` renders the whole of the plain-text mail a
 * prospective customer gets back after asking for a free read on
 * `/wall-takeoff`. It shipped with 44 passing tests and NOTHING IN THE APP
 * CALLING IT. That is the exact shape CLAUDE.md records three live instances
 * of in a single day — 161 `.dbtest.ts` files no runner referenced, a column
 * nothing selected, a helper whose call site still used the value it was
 * written to replace — every one of them GREEN, because nothing referenced
 * the dead code. Its instruction is this file's first half: *"grep for the
 * new symbol and confirm something CALLS it — the tests passing is not that
 * evidence, and neither is the diff looking complete."*
 *
 * AND "SOMETHING CALLS IT" IS NOT THE QUESTION EITHER — THE THING THAT HAS TO
 * CALL IT HAS TO CALL IT. Two files call these functions and they are not
 * interchangeable. `app/(app)/sales/[id]/drawing-read/page.tsx` renders a
 * PREVIEW of the mail for the operator; `lib/actions/takeoffOffer.ts` is what
 * composes and SENDS it. If the action lost its call and only the preview
 * kept one, the operator would read the right text on screen and the prospect
 * would receive nothing — the feature broken in the only way that matters,
 * with a "something calls it" census green the whole time. So the send path
 * is asserted separately below, and the preview is asserted NOT to be what
 * satisfies it.
 *
 * That is CLAUDE.md's expo-router entry arriving one step earlier. There,
 * *"a census can tell you the code is THERE; it can never tell you a
 * framework HONOURS it"* — three fixes shipped green because every test
 * asserted a screen had RECORDED an option while the navigator threw it
 * away. Here the same gap sits between two call sites rather than between
 * code and a framework: a census can tell you SOMETHING calls it and not
 * that the thing which has to call it does. Beside *"nothing is ever missing
 * from a question nobody is asking"*, put: a question asked of the union of
 * two sets is not asked of either one.
 *
 * The second half is why those 44 tests can exist at all. The module's own
 * header promises no Prisma, no `@prova/db` value import, no `process.env`,
 * no I/O — every fact arrives as an argument. That purity is what makes the
 * mail testable against real inputs instead of mocks, including the cases a
 * real PDF cannot cheaply reach (a set that is all scans, a 300-page set).
 * One `prisma` import would take the whole suite with it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * HOW THIS CENSUS KEEPS ITSELF HONEST. CLAUDE.md records three separate ways
 * a census here has gone green while the defect shipped, and this file
 * answers all three by name.
 *
 *   SIZE — *"a pattern matching nothing at all passes every downstream
 *   assertion, since nothing is ever missing from an empty list."* Every set
 *   this file reasons about is sized against a source that cannot drift with
 *   the pattern that found it: the directory walk against `git ls-files`, the
 *   parsed import declarations of each pure module against a count of
 *   statement-starting `import` lines in its raw text, the two guarded
 *   symbols against the module's own runtime exports (imported below, so a
 *   renamed export fails on the import rather than on an empty scan), and the
 *   purity graph against the two dependencies it is known to reach. The
 *   newest member of that family on this branch is the one worth naming: a
 *   stage-map parser used `[^=]*` to cross a type annotation containing
 *   `=> StageWork`, stopped at the arrow, parsed to EMPTY, and every
 *   downstream check would have passed.
 *
 *   SCOPE — *"nothing is ever missing from a directory you do not walk."*
 *   `theme-contrast.test.ts` was green for a month because the one offending
 *   file sat in `packages/ui`, outside its walk. The roots here are DERIVED
 *   from Tailwind's `content` globs, as `lib/colorTokenCensus.test.ts`
 *   derives its own, with one root per glob and each asserted to exist — so a
 *   glob that resolves to nothing fails loudly instead of shrinking the
 *   scanned set, and adding a workspace package to `content` extends this
 *   census with no edit here. `./lib` is added to them deliberately and is
 *   explained at `EXTRA_ROOTS`: the call site this file is looking for is a
 *   server action, and a server action carries no class names, so Tailwind's
 *   globs are the wrong scope for THIS question even though they are the
 *   right one for a colour.
 *
 *   COMMENTS ARE NOT CODE — the #185 scar, a census disarmed by a comment
 *   quoting its own pattern. Everything below is read through the TypeScript
 *   parser, where comments are simply not nodes, and this module proves the
 *   need on itself: `takeoff-delivery.ts:34` writes "no `@prova/db` value
 *   import, no `process.env`" IN PROSE, so a raw-text purity census would
 *   report the honest file as the offender. The same goes the other way for
 *   the call-site half — a commented-out or discussed call is not a call, and
 *   `lib/takeoff-offer.ts:154` already names this module in prose.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * MUTATION-TESTED, five ways, each confirmed to have landed in the file
 * before its result was read and each reverted afterwards:
 *
 *   1. the call site deleted               → RED, naming the symbol
 *   2. the call site left only in a COMMENT → RED (the #185 shape)
 *   1a. ONLY the action's calls removed, the preview's left standing
 *                                          → RED on the send path, GREEN on
 *                                            "something calls it" — which is
 *                                            the pair that proves the two are
 *                                            two questions and not one
 *                                            question written twice
 *   1b. ONLY the preview's call removed     → the send-path test stays GREEN.
 *                                            A census that demands a preview
 *                                            is a census that gets deleted
 *                                            the first time somebody
 *                                            redesigns the page
 *   3. `import { prisma } from "@prova/db"` added to the delivery module
 *                                          → RED on purity
 *   4. the import-parse pattern broken so it matches nothing
 *                                          → RED on SIZE, not a pass
 *   5. a derived root pointed at a directory that does not exist
 *                                          → RED on SCOPE
 *
 * Two notes on how mutation 1 had to be run, dated 2026-10-08 because they
 * are facts about that afternoon rather than about the rule. There were TWO
 * call sites by then — `lib/actions/takeoffOffer.ts` and the drawing-read
 * page — so removing one proved nothing while the other stood, and the
 * mutation had to remove both before the verdict turned red. And mutation 4
 * is the one worth re-reading: with the import parse matching nothing, the
 * purity VERDICT went green on an empty set while the SIZE assertion went
 * red and named the disagreement. That is this file's whole argument in one
 * run — the verdict cannot tell you it was asked about nothing.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IT CANNOT CATCH, because an exemption list and a limits list are the
 * only honest parts of a census:
 *
 *   - a call site reached through a BARREL (`export { deliveryBody } from
 *     "./takeoff-delivery"`, called somewhere else). That needs the re-export
 *     graph; this resolves one import specifier. No such barrel exists today.
 *   - whether the file holding the call site is itself reachable, or whether
 *     the action that composes the mail is ever REACHED. This proves the send
 *     path composes it; it cannot prove a prospect receives it. Only clicking
 *     it does that, which is CLAUDE.md's whole point about the click-list.
 *   - a send path that moved into a plain helper the action calls. The
 *     classifier below takes a `"use server"` directive OR the actions
 *     directory as the signal, so a composer extracted into
 *     `lib/mail/compose.ts` and called by the action would read as the
 *     preview's half of this and go red. That is a false positive on
 *     purpose: it fails loudly and names the choice, rather than quietly
 *     accepting any caller again.
 *   - IMPURITY REACHED DYNAMICALLY. The graph follows static value imports;
 *     a `require` or an `import()` is refused outright rather than followed,
 *     which is why those two are on the banned list below.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import config from "../tailwind.config";
import { listGitFiles } from "../test/git-files";
/* The module under census, imported for real. This is the SIZE assertion for
 * the symbol names themselves: a rename breaks this import — and therefore
 * every test in the file — rather than leaving the scan below looking for a
 * symbol that no longer exists and finding, correctly, nothing. */
import { deliveryBody, deliverySubjectLine } from "./takeoff-delivery";

/** apps/web. Resolved from this file rather than from `process.cwd()`, so a
 *  runner started in another directory cannot silently change the scope. */
const WEB_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPO_ROOT = resolve(WEB_ROOT, "..", "..");

/** The module this census is about. */
const MODULE_REL = "lib/takeoff-delivery.ts";
const MODULE_PATH = join(WEB_ROOT, MODULE_REL);

/**
 * The two exported functions that must have a caller.
 *
 * Both, not either. A subject line without a body is half a mail, and the
 * two are rendered by separate functions precisely so a sender can put them
 * in the two fields `packages/integrations/src/email.ts` takes — so a call
 * site that reached for one and not the other is a mail with no subject or a
 * subject with no mail.
 */
const GUARDED = ["deliverySubjectLine", "deliveryBody"] as const;

/* -------------------------------------------------------- the send path */

/**
 * WHERE THE MAIL IS COMPOSED FOR SENDING, as opposed to merely rendered.
 *
 * Two signals, union, and the first one is the one that cannot be renamed
 * away: a module carrying a top-of-file `"use server"` directive IS a server
 * action, which is read off the file's own first statement rather than off
 * its path. `lib/actions` is the second, for the one case the directive
 * misses — the actions barrel is deliberately NOT a `"use server"` module
 * (its own header says why, and CLAUDE.md records that `export *` inside one
 * fails only at `build`), so a composer living beside it rather than inside
 * an action would otherwise be invisible.
 *
 * THE DIRECTORY IS A NAMED CONSTANT AND THERE IS NO HONEST WAY TO DERIVE IT:
 * nothing in this repo declares "actions live here" in a form another file
 * can read — `next.config`, `tsconfig` and `tailwind.config` all say nothing
 * about it. So it is named, and then pinned: the directory must exist and
 * must still hold the barrel, so a rename fails this census loudly instead of
 * shrinking the send-path set to nothing and passing. The directive is what
 * carries the real weight; this is the belt beside it.
 *
 * A PAGE SATISFIES NEITHER, which is the whole point. An RSC page has no
 * `"use server"` directive — it is a server component, which is a different
 * thing — and it lives under `app/`. So the preview cannot be mistaken for
 * the sender, and the assertion below says so out loud rather than leaving it
 * to be true by accident.
 */
const ACTIONS_DIR_REL = "lib/actions";
const ACTIONS_DIR = join(WEB_ROOT, ACTIONS_DIR_REL);
const ACTIONS_BARREL = join(ACTIONS_DIR, "index.ts");
/** Where pages live. Used only to assert the preview CANNOT satisfy the
 *  send-path test — never to find a call site. */
const PAGES_DIR = join(WEB_ROOT, "app");

/**
 * Is `"use server"` the file's own opening directive?
 *
 * Read off `statements[0]`, so a `"use server"` inside a function body, in a
 * string, or in a COMMENT is not this — and `lib/actions/index.ts`'s header
 * discusses the directive in prose, which a grep would read as carrying it.
 */
export function hasUseServerDirective(source: string, fileName: string): boolean {
  const file = parse(source, fileName);
  const first = file.statements[0];
  if (first === undefined || !ts.isExpressionStatement(first)) return false;
  const expression = first.expression;
  return ts.isStringLiteral(expression) && expression.text === "use server";
}

/** The send path: a server action by its own directive, or a module in the
 *  actions directory. Deliberately NOT "anything that is not a page". */
export function isSendPath(absolutePath: string, source: string): boolean {
  if (hasUseServerDirective(source, absolutePath)) return true;
  return absolutePath.startsWith(ACTIONS_DIR + sep);
}

/* ------------------------------------------------------------------ scope */

/**
 * Roots added to Tailwind's `content` globs, with the reason, because adding
 * one is the thing most likely to be wrong here.
 *
 * `./lib` is not in `content` and should not be: Tailwind's globs are the
 * definition of which files' CLASS NAMES reach the stylesheet, and nothing in
 * `lib/actions` has a class name. But a mail is sent from a server action, so
 * `lib/` is exactly where the caller this census demands will live — and the
 * module under census lives there too. Deriving the roots from `content`
 * alone would be the `theme-contrast.test.ts` failure with the directories
 * swapped: a scope that is right about the set it can see and blind to the
 * set the answer is in.
 */
const EXTRA_ROOTS: { dir: string; why: string }[] = [
  {
    dir: "./lib",
    why:
      "a server action is where mail gets sent from, and `lib` carries no " +
      "class names so Tailwind's content globs deliberately exclude it",
  },
];

type Roots = { roots: string[]; globs: string[]; problems: string[] };

/**
 * One root per `content` glob plus one per `EXTRA_ROOTS` entry.
 *
 * IT RETURNS PROBLEMS RATHER THAN THROWING, for `colorTokenCensus`'s reason
 * and it is not style: this runs while the `describe` bodies are evaluated,
 * so a throw here is a COLLECTION failure, which vitest reports as "no
 * tests" rather than as a red assertion naming the root. "No tests" beside a
 * green sibling is the most ignorable failure there is.
 */
function scanRoots(): Roots {
  const globs = (Array.isArray(config.content) ? config.content : []) as string[];
  const problems: string[] = [];

  if (globs.length < 3) {
    problems.push(
      `tailwind.config.ts declares ${globs.length} content globs — this census ` +
        "would scan almost nothing and pass everything",
    );
  }

  const roots: string[] = [];
  const add = (spec: string, label: string) => {
    const star = spec.indexOf("*");
    const root = resolve(WEB_ROOT, star === -1 ? spec : spec.slice(0, star));
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      problems.push(
        `${label} resolves to ${root}, which is not a directory — a root that ` +
          "resolves to nothing removes files from this census without removing " +
          "them from the app",
      );
      return;
    }
    if (roots.includes(root)) {
      problems.push(
        `${label} resolves to ${root}, which another root already covers — a ` +
          "file scanned twice counts its call sites twice",
      );
      return;
    }
    roots.push(root);
  };

  for (const glob of globs) add(glob, glob);
  for (const extra of EXTRA_ROOTS) add(extra.dir, `${extra.dir} (${extra.why})`);

  return { roots, globs, problems };
}

const { roots, globs, problems } = scanRoots();

/* ------------------------------------------------------------------- walk */

const SOURCE_EXTENSIONS = [".ts", ".tsx"];
/** Never source, never tracked, and enormous. */
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "dist", ".git"]);

function walk(root: string): string[] {
  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(join(dir, entry.name));
      } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        found.push(join(dir, entry.name));
      }
    }
  }
  return found.sort();
}

/**
 * The same question asked of git, which knows nothing about the walk above.
 * `--others --exclude-standard` is deliberate: a brand-new, not-yet-committed
 * page is exactly where the call site is expected to arrive, and a size check
 * that only knew about committed files would stop seeing it.
 */
function trackedUnder(root: string): string[] {
  return listGitFiles(
    ["--cached", "--others", "--exclude-standard", "--", `${relative(REPO_ROOT, root)}/`],
    REPO_ROOT,
  )
    .filter((line) => SOURCE_EXTENSIONS.some((ext) => line.endsWith(ext)))
    .map((line) => join(REPO_ROOT, line))
    .sort();
}

const walked: string[] = [];
for (const root of roots) walked.push(...walk(root));

const isTestFile = (path: string) =>
  /\.(test|dbtest|eval|spec)\.tsx?$/.test(path) || path.includes(`${sep}e2e${sep}`);

/* ---------------------------------------------------------------- resolve */

/**
 * A specifier to a file on disk, for the two forms this app uses: relative,
 * and the `@/` alias `vitest.config.mts` and `tsconfig.json` both point at
 * `apps/web`. Anything else — a bare package name — returns null, which is
 * what makes it NOT LOCAL and therefore an impurity below.
 */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else if (specifier.startsWith("@/")) base = join(WEB_ROOT, specifier.slice(2));
  else return null;

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    base,
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function parse(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

const lineOf = (file: ts.SourceFile, node: ts.Node) =>
  file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

/* ------------------------------------------------- imports, as the AST has them */

type ImportInfo = {
  specifier: string;
  line: number;
  /** Erased at compile time — `import type`, or every named binding `type`. */
  typeOnly: boolean;
  /** Local names bound to each exported name, for the value bindings only. */
  named: { exported: string; local: string }[];
  /** `import * as x from …` */
  namespace: string | null;
  /** `import x from …` */
  defaultName: string | null;
};

/**
 * Every import declaration in one file.
 *
 * SEPARATED FROM THE RULES ON PURPOSE, so the SIZE assertion has something to
 * count: this is the one function every half of this census depends on, and
 * the mutation that breaks it (mutation 4) must fail LOUDLY rather than
 * handing both halves an empty list to find nothing in.
 */
export function moduleImports(source: string, fileName: string): ImportInfo[] {
  const file = parse(source, fileName);
  const out: ImportInfo[] = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    const named: { exported: string; local: string }[] = [];
    let namespace: string | null = null;
    const defaultName = clause?.name?.text ?? null;
    let typeOnly = clause?.isTypeOnly ?? false;

    const bindings = clause?.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) namespace = bindings.name.text;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        named.push({ exported: (element.propertyName ?? element.name).text, local: element.name.text });
      }
      // `import { type A, type B }` erases exactly like `import type { A, B }`.
      if (!typeOnly && named.length === 0 && defaultName === null) typeOnly = true;
    }

    out.push({
      specifier: statement.moduleSpecifier.text,
      line: lineOf(file, statement),
      typeOnly,
      named,
      namespace,
      defaultName,
    });
  }
  return out;
}

/**
 * The SIZE counterpart to `moduleImports`, and it shares no code with it: the
 * number of statement-starting `import` lines in the raw text. Two mechanisms
 * disagreeing means the parse stopped parsing, which is the failure that
 * otherwise reads as "this module imports nothing impure".
 *
 * Continuation lines of a multi-line import are indented, so a wrapped import
 * is one match — which is the whole reason this is anchored.
 */
export function importStatementLines(source: string): number {
  return (source.match(/^import\b/gm) ?? []).length;
}

/* -------------------------------------------------------- half one: the call */

type CallSite = { path: string; line: number; symbol: string; text: string };

/**
 * Calls of the guarded symbols in one file, where the symbol was imported
 * FROM the delivery module.
 *
 * The import is required rather than assumed, so a local function that
 * happens to share a name cannot satisfy this. Both import forms count — a
 * named import and a namespace import — because `clerkMountGate.test.ts` was
 * mutation-tested for exactly the namespace case and a census that misses it
 * would go red on a perfectly good call site.
 */
export function deliveryCallSites(
  source: string,
  fileName: string,
  resolver: (specifier: string) => string | null,
): CallSite[] {
  /** local name → exported name */
  const direct = new Map<string, string>();
  const namespaces = new Set<string>();

  for (const info of moduleImports(source, fileName)) {
    if (info.typeOnly) continue;
    if (resolver(info.specifier) !== MODULE_PATH) continue;
    for (const { exported, local } of info.named) {
      if ((GUARDED as readonly string[]).includes(exported)) direct.set(local, exported);
    }
    if (info.namespace !== null) namespaces.add(info.namespace);
  }
  if (direct.size === 0 && namespaces.size === 0) return [];

  const file = parse(source, fileName);
  const sites: CallSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let symbol: string | null = null;
      if (ts.isIdentifier(callee)) symbol = direct.get(callee.text) ?? null;
      else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        namespaces.has(callee.expression.text) &&
        (GUARDED as readonly string[]).includes(callee.name.text)
      ) {
        symbol = callee.name.text;
      }
      if (symbol !== null) {
        sites.push({ path: fileName, line: lineOf(file, node), symbol, text: callee.getText(file) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return sites;
}

/* ----------------------------------------------------- half two: the purity */

/**
 * Modules a pure mail renderer may not import a VALUE from, each with the
 * reason. The verdict does not actually need this list — the rule below
 * refuses any non-local value import outright, which covers every package
 * that will ever exist — but a failure that can say WHY is worth four lines.
 */
const BANNED: { prefix: string; why: string }[] = [
  { prefix: "@prova/db", why: "a Prisma client: the import alone needs a database to construct" },
  { prefix: "@prisma/client", why: "a Prisma client, reached without going through @prova/db" },
  { prefix: "@prova/integrations", why: "the mail and model SDKs — sending is somebody else's job, and the barrel pulls the model SDK in behind it" },
  { prefix: "next/", why: "request-scoped Next internals (cache, headers, navigation) are I/O" },
  { prefix: "server-only", why: "a module that refuses to be imported where the mail text is tested" },
  { prefix: "node:", why: "a node builtin — the filesystem, the network, the process" },
];

type Impurity = { path: string; line: number; what: string; detail: string };

/** Globals a pure renderer may not read. `process.env` is named in the
 *  module's own header as a thing it does not do, which is precisely why this
 *  is a parser and not a grep. */
const BANNED_GLOBALS = new Set(["process", "globalThis", "fetch", "require", "XMLHttpRequest"]);

export function impurities(source: string, fileName: string): Impurity[] {
  const found: Impurity[] = [];

  for (const info of moduleImports(source, fileName)) {
    if (info.typeOnly) continue;
    const banned = BANNED.find((b) => info.specifier === b.prefix || info.specifier.startsWith(b.prefix));
    if (banned !== undefined) {
      found.push({
        path: fileName,
        line: info.line,
        what: `value import of ${info.specifier}`,
        detail: banned.why,
      });
      continue;
    }
    if (resolveSpecifier(info.specifier, fileName) === null) {
      found.push({
        path: fileName,
        line: info.line,
        what: `value import of ${info.specifier}`,
        detail:
          "not a module inside this app — a pure renderer takes its facts as " +
          "arguments, so anything it has to import at runtime is a dependency " +
          "the unit suite would have to mock",
      });
    }
  }

  const file = parse(source, fileName);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      found.push({
        path: fileName,
        line: lineOf(file, node),
        what: "dynamic import()",
        detail: "an import this census cannot follow is an impurity it cannot rule out",
      });
    }
    if (ts.isIdentifier(node) && BANNED_GLOBALS.has(node.text)) {
      // A property NAME is not a global: `row.process` is a field.
      const parent = node.parent;
      const isPropertyName =
        parent !== undefined &&
        ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node) ||
          ts.isPropertySignature(parent) ||
          ts.isBindingElement(parent) ||
          ts.isImportSpecifier(parent) ||
          ts.isParameter(parent) ||
          ts.isVariableDeclaration(parent));
      if (!isPropertyName) {
        found.push({
          path: fileName,
          line: lineOf(file, node),
          what: node.text,
          detail: "a pure renderer reads no global — every fact arrives as an argument",
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * The delivery module and everything it imports a VALUE from, transitively.
 *
 * Transitive because one level is not the property anybody wants: a local
 * helper that looks pure and imports `prisma` itself makes the mail renderer
 * just as unimportable, and that is the version of this defect a reviewer
 * would wave through.
 */
function purityGraph(): { files: string[]; unresolved: string[] } {
  const seen = new Set<string>();
  const unresolved: string[] = [];
  const stack = [MODULE_PATH];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (seen.has(current)) continue;
    seen.add(current);
    const source = readFileSync(current, "utf8");
    for (const info of moduleImports(source, current)) {
      if (info.typeOnly) continue;
      const target = resolveSpecifier(info.specifier, current);
      if (target === null) continue; // a non-local import; the rules above refuse it
      if (!existsSync(target)) {
        unresolved.push(`${relative(WEB_ROOT, current)}:${info.line} → ${info.specifier}`);
        continue;
      }
      stack.push(target);
    }
  }
  return { files: [...seen].sort(), unresolved };
}

/* --------------------------------------------------------------- the scan */

const scannedAll = walked.map((file) => {
  const source = readFileSync(file, "utf8");
  return {
    abs: file,
    path: relative(REPO_ROOT, file).split(sep).join("/"),
    sites: deliveryCallSites(source, file, (spec) => resolveSpecifier(spec, file)),
  };
});

/** Sites anywhere, including tests and the module itself — kept so the
 *  exclusion below can be proved to have removed something. */
const sitesAnywhere = scannedAll.flatMap((f) => f.sites.map((s) => ({ ...s, path: f.path })));

/** The verdict's set: outside the module, outside every test file. */
const productionFiles = scannedAll.filter((f) => f.abs !== MODULE_PATH && !isTestFile(f.abs));
const productionSites = productionFiles.flatMap((f) => f.sites.map((s) => ({ ...s, path: f.path })));

const graph = purityGraph();
const graphImpurities = graph.files.flatMap((file) =>
  impurities(readFileSync(file, "utf8"), file).map((i) => ({
    ...i,
    path: relative(WEB_ROOT, file).split(sep).join("/"),
  })),
);

/* ------------------------------------------------------------- scope tests */

describe("scope — what this census can see", () => {
  it("derived one root per Tailwind content glob, plus the lib root, and every one exists", () => {
    expect(problems, "this census could not scan what it is supposed to scan").toEqual([]);
    expect(globs.length, "tailwind.config.ts declares no content globs").toBeGreaterThanOrEqual(3);
    // One root per glob plus one per extra. Adding a glob extends this census
    // with no edit here; this is the assertion that says so out loud, and the
    // one a root pointing at a missing directory fails.
    expect(roots).toHaveLength(globs.length + EXTRA_ROOTS.length);
    for (const root of roots) {
      expect(existsSync(root), `scan root does not exist: ${root}`).toBe(true);
      expect(statSync(root).isDirectory(), `scan root is not a directory: ${root}`).toBe(true);
    }
  });

  it("walks the directory the module itself lives in, and the app's pages", () => {
    // Named rather than counted: the call site will be a server action under
    // `lib/actions` or a page under `app/`, and a census that cannot see
    // either of those two directories is answering a different question.
    expect(walked, "the module under census was not walked").toContain(MODULE_PATH);
    expect(
      walked.some((f) => f.startsWith(join(WEB_ROOT, "lib", "actions") + sep)),
      "lib/actions was not walked — a server action is where mail is sent from",
    ).toBe(true);
    expect(
      walked.some((f) => f.startsWith(join(WEB_ROOT, "app") + sep)),
      "app/ was not walked",
    ).toBe(true);
  });
});

describe("size — whether the walk actually walked", () => {
  it("reached every source file git lists under the same roots", () => {
    const fromGit = [...new Set(roots.flatMap(trackedUnder))].sort();
    const walkedSet = new Set(walked);
    // Two independent mechanisms: a recursive readdir against git's own list,
    // which knows nothing about the walk. ONE-DIRECTIONAL on purpose — a file
    // git has and the walk does not is the failure; a file the walk has and
    // git does not is work in progress, and it is scanned anyway.
    const missed = fromGit.filter((file) => !walkedSet.has(file));
    expect(missed, "source files git lists that the walk did not reach").toEqual([]);
    expect(fromGit.length, "git listed almost nothing — is this a checkout?").toBeGreaterThan(300);
    expect(walked.length).toBeGreaterThanOrEqual(fromGit.length);
  });

  it("parsed every file it walked", () => {
    expect(scannedAll).toHaveLength(walked.length);
  });

  it("counts the same imports the raw text does, in every module it judges", () => {
    // THE ANTI-VACUITY ASSERTION FOR THE WHOLE FILE. `moduleImports` is what
    // both halves rest on; a pattern that stopped matching would report a
    // module with no imports, which reads as perfect purity and as "nothing
    // imports the delivery module". Counted against statement-starting
    // `import` lines, which share no code with the parse.
    const disagreements = graph.files
      .map((file) => {
        const source = readFileSync(file, "utf8");
        const parsed = moduleImports(source, file).length;
        const raw = importStatementLines(source);
        return parsed === raw
          ? null
          : `${relative(WEB_ROOT, file)}: parsed ${parsed} import declarations, the text has ${raw} import lines`;
      })
      .filter((line): line is string => line !== null);
    expect(
      disagreements,
      "the import parse and the raw text disagree — fix the parse rather than " +
        "the count: a parse returning nothing passes every purity check below",
    ).toEqual([]);
  });

  it("found the purity graph it is known to reach", () => {
    // The graph's own size assertion. `takeoff-delivery.ts` imports values
    // from exactly these two modules today; a graph of one file means the
    // import parse returned nothing and the purity verdict is vacuous.
    const inGraph = graph.files.map((f) => relative(WEB_ROOT, f).split(sep).join("/"));
    expect(graph.unresolved, "a local value import this census could not resolve").toEqual([]);
    expect(inGraph).toContain(MODULE_REL);
    expect(inGraph).toContain("lib/takeoff-offer.ts");
    expect(inGraph).toContain("lib/plan-ingest/sheetIndex.ts");
    expect(inGraph.length, "the purity graph collapsed to the module alone").toBeGreaterThanOrEqual(3);
  });
});

describe("vacuity — whether the finders can still find", () => {
  const FROM_MODULE = () => MODULE_PATH;

  it("finds a named-import call site", () => {
    const sites = deliveryCallSites(
      'import { deliveryBody } from "./takeoff-delivery";\nexport const x = () => deliveryBody(read);',
      "fixture.ts",
      FROM_MODULE,
    );
    expect(sites).toHaveLength(1);
    expect(sites[0]?.symbol).toBe("deliveryBody");
  });

  it("finds a renamed import, and a namespace import", () => {
    expect(
      deliveryCallSites(
        'import { deliveryBody as render } from "./takeoff-delivery";\nconst s = render(read);',
        "fixture.ts",
        FROM_MODULE,
      ),
    ).toHaveLength(1);
    expect(
      deliveryCallSites(
        'import * as mail from "./takeoff-delivery";\nconst s = mail.deliverySubjectLine(read);',
        "fixture.ts",
        FROM_MODULE,
      ),
    ).toHaveLength(1);
  });

  it("is not fooled by a call that exists only in a comment", () => {
    // THE #185 SHAPE, and the reason this file parses. A call discussed in
    // prose or left commented out is not a call site, and this repo's docs
    // already name this module in prose at `lib/takeoff-offer.ts:154`.
    expect(
      deliveryCallSites(
        'import { deliveryBody } from "./takeoff-delivery";\n// const s = deliveryBody(read);\nexport const x = 1;',
        "fixture.ts",
        FROM_MODULE,
      ),
    ).toHaveLength(0);
    expect(
      deliveryCallSites(
        'import { deliveryBody } from "./takeoff-delivery";\n/** Call `deliveryBody(read)` to render it. */\nexport const x = 1;',
        "fixture.ts",
        FROM_MODULE,
      ),
    ).toHaveLength(0);
  });

  it("counts neither a type-only import nor a same-named local function", () => {
    expect(
      deliveryCallSites(
        'import type { deliveryBody } from "./takeoff-delivery";\nconst s = deliveryBody(read);',
        "fixture.ts",
        FROM_MODULE,
      ),
    ).toHaveLength(0);
    expect(
      deliveryCallSites("function deliveryBody() { return 1; }\nconst s = deliveryBody();", "fixture.ts", FROM_MODULE),
    ).toHaveLength(0);
    // ...nor one imported from somewhere that is not this module.
    expect(
      deliveryCallSites(
        'import { deliveryBody } from "./somewhere-else";\nconst s = deliveryBody(read);',
        "fixture.ts",
        () => null,
      ),
    ).toHaveLength(0);
  });

  it("flags the import and the global this module promises not to have", () => {
    const prisma = impurities('import { prisma } from "@prova/db";\nexport const x = 1;', MODULE_PATH);
    expect(prisma).toHaveLength(1);
    expect(prisma[0]?.what).toContain("@prova/db");

    expect(impurities("export const a = process.env.FOO;", MODULE_PATH).length).toBeGreaterThan(0);
    expect(impurities("export const a = () => fetch(url);", MODULE_PATH).length).toBeGreaterThan(0);
    expect(impurities('export const a = () => import("./x");', MODULE_PATH).length).toBeGreaterThan(0);
    expect(impurities('import fs from "node:fs";\nexport const x = 1;', MODULE_PATH).length).toBeGreaterThan(0);
  });

  it("leaves a type-only import and prose about one alone", () => {
    // `takeoff-delivery.ts:34` writes "no `@prova/db` value import, no
    // `process.env`" IN ITS HEADER, and `takeoff-offer.ts` imports
    // `PlanIngestStage` as a type. A raw-text census reports both as
    // offenders; this one must report neither, or the honest file is red.
    expect(impurities('import type { PlanIngestStage } from "@prova/db";\nexport const x = 1;', MODULE_PATH)).toEqual([]);
    expect(impurities('import { type A, type B } from "@prova/db";\nexport const x = 1;', MODULE_PATH)).toEqual([]);
    expect(impurities("/** No `@prova/db` value import, no `process.env`. */\nexport const x = 1;", MODULE_PATH)).toEqual([]);
    expect(impurities("// process.env.FOO was read here once\nexport const x = 1;", MODULE_PATH)).toEqual([]);
  });

  it("counts an import statement whether or not it is wrapped", () => {
    expect(importStatementLines('import { a } from "x";\n')).toBe(1);
    expect(importStatementLines('import {\n  a,\n  b,\n} from "x";\n')).toBe(1);
    expect(importStatementLines('const s = "import { a } from \\"x\\"";\n')).toBe(0);
  });
});

/* -------------------------------------------------- half one: the verdict */

describe("the delivery email has a caller", () => {
  it("excluded the tests and the module itself, and that exclusion removed something", () => {
    // A filter that silently matched everything would leave the verdict below
    // reading the same set it started with. `takeoff-delivery.test.ts` calls
    // these functions dozens of times, so the difference is the proof.
    expect(
      sitesAnywhere.length,
      "no call site anywhere, not even in the test file — the finder has stopped finding",
    ).toBeGreaterThan(0);
    expect(
      sitesAnywhere.length,
      "the exclusion removed nothing: a call site reached only through a test " +
        "file does not prove the app calls this, which is the whole point",
    ).toBeGreaterThan(productionSites.length);
    expect(
      sitesAnywhere.some((s) => isTestFile(s.path)),
      "the excluded set holds no test file",
    ).toBe(true);
  });

  it("exports both guarded symbols as functions", () => {
    // The independent mechanism for the symbol NAMES: these are the real
    // exports, imported at the top. A rename fails here instead of letting
    // the scan search for a symbol nothing declares and find nothing.
    expect(typeof deliverySubjectLine).toBe("function");
    expect(typeof deliveryBody).toBe("function");
    expect(GUARDED).toEqual(["deliverySubjectLine", "deliveryBody"]);
  });

  it.each(GUARDED)("something outside the module and outside the tests calls %s", (symbol) => {
    const callers = productionSites
      .filter((s) => s.symbol === symbol)
      .map((s) => `${s.path}:${s.line}  ${s.text}`)
      .sort();
    expect(
      callers,
      `NOTHING CALLS ${symbol}. ` +
        "`lib/takeoff-delivery.ts` renders the whole of the mail a prospective " +
        "customer gets back after asking for a free read, and its tests pass " +
        "whether or not the app ever sends it — which is CLAUDE.md's " +
        '"written, documented, and never called" shape, three live instances ' +
        "of it in one day, every one green. A call from a `.test.ts` does not " +
        "count and neither does one inside the module. Wire it into the " +
        "sender: a server action under `lib/actions`, or the drawing-read page " +
        "under `app/(app)/sales/[id]/`.\n" +
        `Call sites found outside tests: ${productionSites.length}\n`,
    ).not.toEqual([]);
  });
});

/* -------------------------------------------------- half two: the verdict */

describe("the delivery email stays pure", () => {
  it("imports no database, no mail provider, no node builtin, and reads no global", () => {
    expect(
      graphImpurities.map((i) => `${i.path}:${i.line}  ${i.what} — ${i.detail}`).sort(),
      "`lib/takeoff-delivery.ts` and everything it imports a value from must " +
        "take every fact as an argument. That purity is not tidiness: it is " +
        "what lets 44 tests execute the real mail against real inputs with no " +
        "database and no mocks, including the cases a real PDF cannot cheaply " +
        "reach. One `prisma` import makes the module unimportable wherever " +
        "`@prova/db` is stubbed, and takes the whole suite with it.",
    ).toEqual([]);
  });

  it("names a reason for every module it bans, so a failure can say why", () => {
    // An empty ban list would make the message above say nothing. The verdict
    // does not depend on it — a non-local value import is refused anyway —
    // but a failure that cannot explain itself gets argued with.
    expect(BANNED.length).toBeGreaterThanOrEqual(5);
    for (const { prefix, why } of BANNED) {
      expect(prefix.length).toBeGreaterThan(0);
      expect(why.length, `banned module with no reason: ${prefix}`).toBeGreaterThan(20);
    }
    expect(BANNED.some((b) => b.prefix === "@prova/db")).toBe(true);
  });
});
