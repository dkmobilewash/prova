import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITIES, type Capability } from "./permissions";

/**
 * NO SERVER ACTION MINTS A BEARER CREDENTIAL WITHOUT A CAPABILITY BEHIND
 * IT, AND NO CONTROL THAT POSTS TO ONE IS SHOWN TO SOMEBODY THE ACTION
 * WILL REFUSE.
 *
 * WHAT WENT WRONG, and it is the reason this file is about a GENERATOR
 * rather than about two function names. `enablePortalAccess` and
 * `revokeClientPortalAccess` (lib/actions/billing.ts) called
 * `requireCompanyContext()`, checked `contact.companyId !== company.id`,
 * and stopped. So any authenticated member of the company — a FIELD crew
 * member on a phone in a jobsite trailer included — could POST to a stable
 * action id and mint `Contact.portalToken`: the string that IS the login to
 * `/portal/<token>`, where a GC reads the contract, the change orders and
 * every invoice with its payments. No password, no expiry, no rotation.
 *
 * The app already knew that field was a credential. #527 exports
 * `portalRevokedAt` from the contact CSV and keeps `portalToken` in
 * `EXPORT_WITHHELD` *because it is a bearer credential* (lib/export.ts).
 * So the repo withheld the string from the customer's own download while
 * letting anyone on the payroll issue one — which is the first question a
 * GC's IT person asks.
 *
 * WHY THE EXISTING CENSUS COULD NOT SEE IT, because that is the interesting
 * half. `lib/action-capability-guards.test.ts` DID see these two — it
 * listed them in `UNDECIDED_BEHIND_AN_AMBIGUOUS_PAGE`, by name, as "the
 * highest-risk item on this page". It could not decide them, and its rule
 * is derived from the PAGE: an action is required to assert the capability
 * its door withholds on, and `/contacts/[id]` withholds on three
 * capabilities section by section, so the derivation yields nothing. Had
 * the portal controls lived on a page that withheld nothing at all, they
 * would not even have been listed.
 *
 * That is the structural gap this file closes. A credential's risk does not
 * come from the page it is minted on. So the needle here is not a page and
 * not a list of actions — it is `linkToken()` (lib/tokens.ts), which that
 * file's own doc comment calls "the one generator for links that ARE their
 * own access control", plus the fields that switch such a link on and off.
 * Add a new outward-facing token anywhere in this app and it lands in this
 * census on the strength of calling that generator, whatever page it is
 * reached from and whether or not anybody remembered this file.
 *
 * THE THREE SHAPES CLAUDE.md REQUIRES OF A CHECK THAT DERIVES ITS OWN SET,
 * each one of them a scar somebody else paid for:
 *
 *   SCOPE — "nothing is ever missing from a directory you do not walk"
 *   (theme-contrast, #507). The walk's roots are derived from
 *   `apps/web/tsconfig.json`'s own `include` globs, not from this file's
 *   directory: a file TypeScript does not compile is not part of the app,
 *   and a glob that resolves to nothing fails here rather than silently
 *   shrinking the scan.
 *
 *   SIZE — "a pattern matching nothing passes every downstream assertion"
 *   (scratch-cleanup-order, #224). Two independent counts. The set of
 *   `"use server"` modules is cross-checked against the actions barrel,
 *   which shares no regex with it. And every single `linkToken(` call site
 *   and every credential-field write must be ATTRIBUTED to an exported
 *   async function — a hit that lands nowhere is reported by name instead
 *   of being dropped, because a hit silently dropped is a guard silently
 *   not required.
 *
 *   COMMENTS STRIPPED — the #185 shape, where a census was disarmed by a
 *   comment quoting its own pattern. It is not hypothetical here:
 *   `lib/actions/billing.ts`'s own doc comments say `linkToken()` and
 *   `portalToken` several times, and one of them sits inside
 *   `enablePortalAccess`'s docblock. A raw-text census would find call
 *   sites that do not exist and, worse, would accept a capability check
 *   that was only ever written in a comment. Both directions are
 *   mutation-tested below.
 *
 * AND THE HALF A GATE ALONE DOES NOT BUY. Both portal actions refuse by
 * THROWING, matching every sibling in their module. Production redacts a
 * thrown Server Action message to a digest (CLAUDE.md, verified on a real
 * production build), so a refusal nobody can read is a dead button: the
 * person clicks, nothing happens, and they file a bug. So this file also
 * requires the CONTROL to be hidden — every `action={…}` that posts to a
 * gated credential action must sit inside a region the page withholds on
 * the SAME capability the action asserts. The action is the boundary; the
 * hiding is what stops a real person ever meeting it.
 */

/* ------------------------------------------------------------------ *
 * 1. Scope: what this census can see
 * ------------------------------------------------------------------ */

const WEB = resolve(__dirname, "..");

/** The roots, from tsconfig's `include` rather than from this file.
 *
 * `"**\/*.ts"` and `"**\/*.tsx"` both resolve to the app root; a future
 * `include` naming a subdirectory would narrow this automatically, and a
 * glob naming a directory that does not exist fails below. Declaration and
 * generated globs are dropped — nothing hand-written lives in them. */
function includeGlobs(): string[] {
  const raw = readFileSync(join(WEB, "tsconfig.json"), "utf8");
  const config = JSON.parse(raw) as { include?: string[] };
  return config.include ?? [];
}

const SOURCE_GLOBS = includeGlobs().filter(
  (glob) => /\.tsx?$/.test(glob) && !glob.endsWith(".d.ts") && !glob.startsWith(".next"),
);

/** One root per glob, deduped — the directory the glob's `**` starts at. */
const ROOTS = [
  ...new Set(
    SOURCE_GLOBS.map((glob) => {
      const upToWildcard = glob.split("*")[0];
      return resolve(WEB, upToWildcard.replace(/\/$/, "") || ".");
    }),
  ),
];

const SKIP = new Set(["node_modules", ".next", ".turbo", "dist"]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

const FILES = [...new Set(ROOTS.flatMap((root) => walk(root)))].sort();
const rel = (file: string) => relative(WEB, file);

/* ------------------------------------------------------------------ *
 * 2. Reading sources with comments gone
 * ------------------------------------------------------------------ */

/** Block and line comments removed, LENGTH PRESERVED.
 *
 * Every offset this file reports or compares — a guard's position against
 * the first query, a form attribute's position against a withheld region —
 * is an index into this string, so replacing a comment with spaces rather
 * than deleting it keeps those offsets meaningful and keeps a reported line
 * number honest. */
function stripComments(source: string): string {
  const blanked = (match: string) => match.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blanked)
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (match, lead: string) => lead + blanked(match.slice(lead.length)));
}

const bare = new Map<string, string>();
function sourceOf(file: string): string {
  let cached = bare.get(file);
  if (cached === undefined) {
    cached = stripComments(readFileSync(file, "utf8"));
    bare.set(file, cached);
  }
  return cached;
}

const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;

/* ------------------------------------------------------------------ *
 * 3. The server-action modules, counted twice
 * ------------------------------------------------------------------ */

/** A module Next treats as Server Actions: the directive is the first
 * thing in the file. */
const SERVER_MODULES = FILES.filter((file) => sourceOf(file).trimStart().startsWith('"use server"'));

/** The SECOND count, sharing no expression with the first: every module the
 * actions barrel re-exports. The barrel is what the app imports, so a
 * module missing from it is not reachable as an action from a page — and if
 * the directive test above ever stops matching, this disagrees instead of
 * the census going quiet. */
const BARREL_MODULES = [
  ...sourceOf(join(WEB, "lib/actions/index.ts")).matchAll(/export \* from "\.\/([\w.-]+)"/g),
].map((match) => join(WEB, "lib/actions", `${match[1]}.ts`));

/* ------------------------------------------------------------------ *
 * 4. Exported actions, by brace matching
 * ------------------------------------------------------------------ */

type Fn = { name: string; module: string; body: string; offset: number };

function exportedFunctions(file: string): Fn[] {
  const source = sourceOf(file);
  const found: Fn[] = [];
  for (const match of source.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)\s*\(/g)) {
    const open = source.indexOf("{", match.index + match[0].length - 1);
    if (open < 0) continue;
    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    found.push({ name: match[1], module: file, body: source.slice(match.index, end + 1), offset: match.index });
  }
  return found;
}

const ACTIONS = SERVER_MODULES.flatMap(exportedFunctions);

/* ------------------------------------------------------------------ *
 * 5. The credential: its generator, and the fields that switch it
 * ------------------------------------------------------------------ */

const SCHEMA_DIR = resolve(WEB, "../../packages/db/prisma/schema");

/** The `Contact` model's own portal fields, read out of the schema.
 *
 * Pinned to the schema rather than typed here so that RENAMING the field
 * fails this census by name instead of leaving its patterns matching
 * nothing. The equality against a literal set below is the other half: a
 * NEW `portal…` field arriving on Contact is a decision about what else is
 * part of this credential, and it stops the build until somebody makes it. */
function portalFieldsOnContact(): string[] {
  const files = readdirSync(SCHEMA_DIR).filter((name) => name.endsWith(".prisma"));
  for (const name of files) {
    const text = readFileSync(join(SCHEMA_DIR, name), "utf8");
    const match = /\nmodel Contact \{([\s\S]*?)\n\}/.exec(text);
    if (!match) continue;
    return [...match[1].matchAll(/^\s{2}(portal[A-Za-z0-9_]*)\s+\S/gm)].map((field) => field[1]).sort();
  }
  return [];
}

const PORTAL_FIELDS = portalFieldsOnContact();

/** Prisma calls that WRITE. A `select: { portalToken: true }` is a read and
 * must not be mistaken for minting one, so the field names are looked for
 * inside these call regions only. */
const WRITE_CALL = /prisma\.[A-Za-z0-9_]+\.(update|updateMany|upsert|create|createMany)\s*\(/g;

function writeRegions(body: string): string[] {
  const regions: string[] = [];
  for (const match of body.matchAll(WRITE_CALL)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < body.length; i += 1) {
      if (body[i] === "(") depth += 1;
      else if (body[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          regions.push(body.slice(open, i + 1));
          break;
        }
      }
    }
  }
  return regions;
}

/** Mints a bearer credential: calls the one generator. */
const mints = (fn: Fn) => /\blinkToken\s*\(/.test(fn.body);

/** Switches the portal credential on or off — the revoke/reinstate half,
 * which mints nothing and is every bit as much a decision about who may
 * reach a GC's paperwork. */
const switchesPortal = (fn: Fn) =>
  writeRegions(fn.body).some((region) =>
    PORTAL_FIELDS.some((field) => new RegExp(`\\b${field}\\s*:`).test(region)),
  );

const CREDENTIAL_ACTIONS = ACTIONS.filter((fn) => mints(fn) || switchesPortal(fn));

/* ------------------------------------------------------------------ *
 * 6. What a gate looks like, and where it sits
 * ------------------------------------------------------------------ */

/** The capability an action asserts, and the offset it asserts it at.
 *
 * Both house forms: `can(context, "X")` for a module whose guards are
 * hand-written (lib/actions/billing.ts) and `requireCapabilityForAction`
 * for one using the shared helper (lib/authz.ts). */
function assertedCapability(fn: Fn): { capability: Capability; at: number } | null {
  for (const capability of CAPABILITIES) {
    for (const pattern of [
      `can(context, "${capability}")`,
      `requireCapabilityForAction("${capability}"`,
    ]) {
      const at = fn.body.indexOf(pattern);
      if (at >= 0) return { capability, at };
    }
  }
  return null;
}

/**
 * The credential actions that answer to nobody's capability, each with the
 * reason — because absence is not a decision, and a census with no room to
 * say "deliberately not" gets deleted the first time it is inconvenient.
 *
 * MAY ONLY SHRINK. An entry here is a claim that the credential being
 * minted reaches nothing the caller could not already reach, which is a
 * much narrower claim than "this seems fine".
 */
const NO_CAPABILITY_BY_DESIGN: Record<string, string> = {
  "calendarFeed.ensureCalendarFeedToken":
    "The token minted is the CALLER'S OWN and nobody else's: the row is keyed (companyId, userId), so this action can neither read nor issue nor rotate another person's link, and the feed serves exactly what /schedule already shows the same person. /schedule is open to every signed-in member on purpose (absent from ROUTE_CAPABILITY), so a capability here would withhold a subscription link to a calendar the person is looking at. The module's own doc comment argues this at length and predates this census.",
  "calendarFeed.regenerateCalendarFeedToken":
    "The other half of ensureCalendarFeedToken, on the same (companyId, userId) row: it replaces the caller's own token, which kills only the caller's own subscription URL. Rotating your own credential is not an action on shared data, which is also why it carries no ownerRefusal.",
};

/* ------------------------------------------------------------------ *
 * 7. Where the control is, and what hides it
 * ------------------------------------------------------------------ */

/** `jobCapabilities()`'s four flags, parsed from the file that defines them
 * rather than copied here — the same reason the fields come from the
 * schema. Asserted non-empty below. */
function sharedFlags(): Record<string, Capability> {
  const source = sourceOf(join(WEB, "lib/jobs/job-access.ts"));
  const flags: Record<string, Capability> = {};
  for (const match of source.matchAll(/(\w+):\s*can\(principal,\s*"([A-Z_]+)"\)/g)) {
    if (CAPABILITIES.includes(match[2] as Capability)) flags[match[1]] = match[2] as Capability;
  }
  return flags;
}

const SHARED_FLAGS = sharedFlags();

/** Every name in this file that stands for "this person holds X": the four
 * shared flags, plus any local `const x = can(principal, "X")`. */
function flagsFor(source: string): Record<string, Capability> {
  const flags: Record<string, Capability> = { ...SHARED_FLAGS };
  for (const match of source.matchAll(/const\s+(\w+)\s*=\s*can\(principal,\s*"([A-Z_]+)"\)/g)) {
    if (CAPABILITIES.includes(match[2] as Capability)) flags[match[1]] = match[2] as Capability;
  }
  return flags;
}

/** The `[start, end]` of every `{flag && ( … )}` region, by brace depth.
 * Comments are already gone, so nothing here is fooled by one. */
function withheldRegions(source: string, flag: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const match of source.matchAll(new RegExp(`\\{\\s*${flag}\\s*&&\\s*\\(`, "g"))) {
    let depth = 0;
    for (let i = match.index; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          spans.push([match.index, i]);
          break;
        }
      }
    }
  }
  return spans;
}

/** Identifiers that carry this action into JSX: the action itself, plus
 * every `const x = …action…` binding. Catches both house shapes — a direct
 * `.bind(null, id)` and an arrow returning one. */
function carriers(source: string, action: string): string[] {
  const names = new Set([action]);
  for (const match of source.matchAll(/const\s+(\w+)\s*=\s*([^;\n]*(?:\n[^;\n]*)?);/g)) {
    if (new RegExp(`\\b${action}\\b`).test(match[2])) names.add(match[1]);
  }
  return [...names];
}

/** Every `action={…}` / `formAction={…}` whose expression posts to this
 * action, as offsets into the comment-stripped source. */
function controlSites(source: string, action: string): number[] {
  const names = carriers(source, action);
  const sites: number[] = [];
  for (const match of source.matchAll(/\b(?:action|formAction)=\{/g)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          const expression = source.slice(open, i + 1);
          if (names.some((name) => new RegExp(`\\b${name}\\b`).test(expression))) sites.push(match.index);
          break;
        }
      }
    }
  }
  return sites;
}

const IMPORTERS = FILES.filter(
  (file) => !/\.(test|dbtest)\.tsx?$/.test(file) && !SERVER_MODULES.includes(file),
);

/* ------------------------------------------------------------------ *
 * 8. The checks
 * ------------------------------------------------------------------ */

describe("the walk this census rests on", () => {
  it("has roots it did not choose for itself, and they exist", () => {
    expect(SOURCE_GLOBS.length, "tsconfig.json declares no TypeScript source globs").toBeGreaterThan(0);
    expect(ROOTS.length).toBe(1);
    for (const root of ROOTS) expect(existsSync(root), `${root} does not exist`).toBe(true);
    // A walk that finds nothing satisfies every "nothing is ungated"
    // assertion below. Named files, not only a floor: a count can be met by
    // a walk that is wrong about WHICH files it found.
    expect(FILES.length).toBeGreaterThan(700);
    expect(FILES.map(rel)).toContain("lib/actions/billing.ts");
    expect(FILES.map(rel)).toContain("app/(app)/contacts/[id]/page.tsx");
  });

  it("counts the Server Action modules twice, from sources that share no pattern", () => {
    expect(BARREL_MODULES.length, "the actions barrel yielded no modules").toBeGreaterThan(50);
    expect(
      SERVER_MODULES.map(rel).sort(),
      `The "use server" directive scan and the actions barrel disagree. One of them has ` +
        `stopped matching, and whichever it is, this census is now reasoning about a set ` +
        `that is missing modules — where nothing is ever ungated.`,
    ).toEqual(BARREL_MODULES.map(rel).sort());
    expect(ACTIONS.length, "no exported actions were parsed out of those modules").toBeGreaterThan(300);
  });

  it("reads the credential's fields off the schema, not out of this file", () => {
    expect(
      PORTAL_FIELDS,
      `The Contact model's portal fields are not what this census was written against. If a ` +
        `field was renamed, every pattern here is now matching nothing; if one was ADDED, ` +
        `decide whether it switches the credential and say so here.`,
    ).toEqual(["portalRevokedAt", "portalToken"]);
    expect(Object.keys(SHARED_FLAGS).length, "jobCapabilities() yielded no flags").toBe(4);
    expect(SHARED_FLAGS.showsBilling).toBe("MANAGE_BILLING");
  });

  it("strips comments in both directions, because one comment each way is a false answer", () => {
    // Not decoration: `lib/actions/billing.ts` prints `linkToken()` and
    // `portalToken` inside its own docblocks, one of them INSIDE
    // enablePortalAccess's. A raw-text census finds call sites that do not
    // exist and accepts guards that were only ever written down.
    const gateInAComment = stripComments(`
      export async function x() {
        // if (!can(context, "MANAGE_BILLING")) throw new Error(m);
        await prisma.contact.update({ data: { portalToken: linkToken() } });
      }
    `);
    expect(gateInAComment).not.toContain('can(context, "MANAGE_BILLING")');
    const callInAComment = stripComments(`/** mints with linkToken() */ export async function y() {}`);
    expect(callInAComment).not.toContain("linkToken(");
    // And length is preserved, or every offset comparison below is wrong.
    const original = `a // b\n/* c */ d`;
    expect(stripComments(original).length).toBe(original.length);
  });

  it("attributes every credential hit to an exported action, dropping none", () => {
    // THE SIZE ASSERTION, and the shape CLAUDE.md's scratch-cleanup-order
    // entry paid for: a parse has two failure modes and only one looks like
    // a failure. Counting the hits INSIDE the attributed bodies against the
    // hits in the whole module means a call site the function parser missed
    // — a new `export const x = async () => …`, a nested helper, a
    // re-exported wrapper — fails here by name instead of quietly not being
    // required to have a guard.
    const unattributed: string[] = [];
    for (const file of SERVER_MODULES) {
      const source = sourceOf(file);
      const bodies = exportedFunctions(file);
      for (const pattern of [/\blinkToken\s*\(/g, ...PORTAL_FIELDS.map((f) => new RegExp(`\\b${f}\\s*:`, "g"))]) {
        for (const hit of source.matchAll(pattern)) {
          const owner = bodies.find(
            (fn) => hit.index >= fn.offset && hit.index < fn.offset + fn.body.length,
          );
          if (!owner) unattributed.push(`${rel(file)}:${lineOf(source, hit.index)} — ${hit[0].trim()}`);
        }
      }
    }
    expect(
      unattributed,
      `These credential operations are in a Server Action module and inside no exported async ` +
        `function this census can see:\n${unattributed.join("\n")}\n\nEvery check below is of ` +
        `the form "no action was found ungated", and an operation attributed to no action is ` +
        `not a small set — it is not in the set at all.`,
    ).toEqual([]);

    // And it must have found some. Named, because a floor is met by a walk
    // that found the wrong ones.
    const names = CREDENTIAL_ACTIONS.map((fn) => fn.name);
    expect(names).toContain("enablePortalAccess");
    expect(names).toContain("revokeClientPortalAccess");
    expect(names).toContain("createSignatureRequest");
    expect(names.length).toBeGreaterThanOrEqual(4);
  });
});

describe("a bearer credential is minted only by somebody a capability admits", () => {
  it("leaves no credential action ungated and unaccounted for", () => {
    const holes: string[] = [];
    for (const fn of CREDENTIAL_ACTIONS) {
      const key = `${rel(fn.module).replace(/^lib\/actions\//, "").replace(/\.ts$/, "")}.${fn.name}`;
      if (assertedCapability(fn)) continue;
      if (key in NO_CAPABILITY_BY_DESIGN) continue;
      holes.push(`${key} (${mints(fn) ? "mints a token with linkToken()" : "switches the portal credential"})`);
    }
    expect(
      holes,
      `These Server Actions hand out or withdraw a bearer credential and answer whoever posts ` +
        `to them:\n${holes.map((hole) => `  ${hole}`).join("\n")}\n\nA Server Action is an HTTP ` +
        `endpoint with a stable id; the page it is reached from is not a boundary for it. Assert ` +
        `the capability the credential's own contents demand — can(context, "X") plus a thrown ` +
        `or returned refusal, per the module's style — or record in NO_CAPABILITY_BY_DESIGN why ` +
        `the token reaches nothing the caller could not already reach. Absence is not a decision.`,
    ).toEqual([]);
  });

  it("keeps the by-design list honest — no stale entry, no entry that is now gated", () => {
    const wrong: string[] = [];
    const keys = CREDENTIAL_ACTIONS.map(
      (fn) => `${rel(fn.module).replace(/^lib\/actions\//, "").replace(/\.ts$/, "")}.${fn.name}`,
    );
    for (const key of Object.keys(NO_CAPABILITY_BY_DESIGN)) {
      const index = keys.indexOf(key);
      if (index < 0) {
        wrong.push(`${key} — no longer mints or switches a bearer credential; delete this entry`);
        continue;
      }
      const asserted = assertedCapability(CREDENTIAL_ACTIONS[index]);
      if (asserted) {
        wrong.push(`${key} — recorded as needing no capability and now asserts ${asserted.capability}; delete this entry`);
      }
      expect(NO_CAPABILITY_BY_DESIGN[key].length).toBeGreaterThan(120);
    }
    expect(wrong, `The by-design exemptions no longer match the code:\n${wrong.join("\n")}`).toEqual([]);
  });

  it("puts the guard before the first query, not after it", () => {
    // The refusal has to arrive before anything is read, or the guard is a
    // comment on work already done. Same standard action-capability-guards
    // executes with its database tripwire; here it is the textual half, and
    // it covers the actions that suite cannot derive a requirement for.
    const late: string[] = [];
    for (const fn of CREDENTIAL_ACTIONS) {
      const asserted = assertedCapability(fn);
      if (!asserted) continue;
      const firstQuery = fn.body.indexOf("prisma.");
      if (firstQuery >= 0 && firstQuery < asserted.at) {
        late.push(`${fn.name} — asserts ${asserted.capability} AFTER its first prisma call`);
      }
    }
    expect(late, late.join("\n")).toEqual([]);
  });

  it("names MANAGE_BILLING on both halves of the client portal link", () => {
    // The floor with named members, so that a parse going blind fails here
    // rather than passing an empty set. MANAGE_BILLING is derived from what
    // the link OPENS — `/portal/[token]` renders the contract total, the
    // change orders and every invoice with its payments and
    // retainage-adjusted balance, which is that capability's own doc
    // comment in lib/permissions.ts. Not VIEW_JOB_COSTS: that is the inside
    // view of cost and margin, which the portal shows a GC none of.
    for (const name of ["enablePortalAccess", "revokeClientPortalAccess"]) {
      const fn = CREDENTIAL_ACTIONS.find((candidate) => candidate.name === name);
      expect(fn, `${name} is no longer found as a credential action`).toBeDefined();
      expect(assertedCapability(fn as Fn)?.capability, `${name} must assert MANAGE_BILLING`).toBe(
        "MANAGE_BILLING",
      );
    }
  });
});

describe("the control is hidden from whoever the action refuses", () => {
  it("withholds every form that posts to a gated credential action", () => {
    const problems: string[] = [];
    let sitesChecked = 0;

    for (const fn of CREDENTIAL_ACTIONS) {
      const asserted = assertedCapability(fn);
      if (!asserted) continue;

      let rendered = 0;
      for (const file of IMPORTERS) {
        const source = sourceOf(file);
        if (!new RegExp(`\\b${fn.name}\\b`).test(source)) continue;
        const sites = controlSites(source, fn.name);
        if (sites.length === 0) continue;
        rendered += sites.length;

        const flags = flagsFor(source);
        const spans = Object.entries(flags)
          .filter(([, capability]) => capability === asserted.capability)
          .flatMap(([flag]) => withheldRegions(source, flag));

        if (spans.length === 0) {
          problems.push(
            `${rel(file)} renders ${sites.length} control(s) for ${fn.name} and withholds ` +
              `nothing on ${asserted.capability}. The action refuses by throwing and production ` +
              `redacts a thrown message, so this is a dead button, not a refusal.`,
          );
          continue;
        }
        for (const site of sites) {
          sitesChecked += 1;
          if (!spans.some(([start, end]) => site >= start && site <= end)) {
            problems.push(
              `${rel(file)}:${lineOf(source, site)} posts to ${fn.name} from outside every ` +
                `region this page withholds on ${asserted.capability}.`,
            );
          }
        }
      }

      // A gated action nothing renders makes the loop above vacuous for it.
      // That is not a pass — it is either dead code or a control this
      // census cannot see, and both want saying out loud.
      if (rendered === 0) {
        problems.push(
          `${fn.name} asserts ${asserted.capability} and this census found no form posting to ` +
            `it. Either nothing renders it (delete it) or the control is reached in a shape ` +
            `controlSites() does not parse (teach it).`,
        );
      }
    }

    expect(problems, problems.join("\n\n")).toEqual([]);
    // The control on the control. Every assertion above is "nothing was
    // found wrong", and an empty set of sites satisfies all of them.
    //
    // FIVE is what the app renders today, and the breakdown is written down
    // so that whoever moves this number has to say which control changed:
    // `enablePortalAccess` twice on `/contacts/[id]` (the no-access branch
    // and the re-enable branch), `revokeClientPortalAccess` once, and
    // `createSignatureRequest` twice on the job Overview tab. A floor rather
    // than an equality, so adding a control does not fail a build over a
    // number — the per-action `rendered === 0` check above is what actually
    // catches a control disappearing.
    expect(sitesChecked, "no control sites were examined at all").toBeGreaterThanOrEqual(5);
  });
});
