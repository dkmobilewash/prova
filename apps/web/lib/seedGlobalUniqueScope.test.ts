import { describe as group, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * CAN THE DEMO SEED FILL A SECOND COMPANY ON ONE DATABASE?
 *
 * It could not, and it failed in the worst possible order. Seeding
 * "Cyrus's Company" on ep-patient-lake, which already held a demo set under
 * "My Company", wrote the jobs, the GC contacts, six crew, 49 time entries and
 * eight equipment items and then died — CI run 36358650969:
 *
 *     seed: FAILED — Unique constraint failed on the fields: (`providerMessageId`)
 *
 * That is issue #180's shape exactly: a company left holding a PARTIAL demo
 * set, and the reseed guard next door then refuses the retry, because it counts
 * tagged rows per family and finds some. `providerMessageId` was built as
 * `demo-<MARK>-<address>-<day>`, which is unique per company and collides
 * ACROSS companies, because that column is `@unique` with NO company in the
 * key — correctly so: it holds a provider's own id, and two providers never
 * issue the same one. Every other tag this script writes is scoped by a
 * `where: { companyId }`, which is exactly why nothing caught it. It is the
 * only value the DATABASE requires to be globally unique.
 *
 * The fix was one interpolation. THIS FILE IS THE PART THAT LASTS. The
 * intersection that found the bug — every single-field `@unique` in the schema
 * against every model the seed writes — was done once, by hand, and a one-off
 * check rots the day somebody seeds a new model carrying a globally unique tag.
 * Nobody had ever run this seed against two companies on one database; the demo
 * project grew a second and a third the moment people began signing in to
 * previews, so the assumption stopped holding without a line of the script
 * changing. The next such assumption should fail on a laptop in a second
 * instead of half way through somebody's demo database.
 *
 * Read as text rather than imported, like seed-reseed-guard.test.ts next door:
 * the script loads .env and exits on a host mismatch, so importing it would
 * either connect to a database or kill the run.
 *
 * Built to the three rules CLAUDE.md sets for a check that DERIVES its own
 * input, because all three failure modes are live here:
 *
 *   SIZE      — a pattern that stops matching must go red, not quietly reason
 *               about an empty set. Both derived sets are counted against an
 *               expression sharing no regex with the one that built them:
 *               plain string splits.
 *   SCOPE     — nothing is ever missing from a directory you do not walk. The
 *               schema folder comes from packages/db/package.json's own
 *               `prisma.schema` — what Prisma itself reads — and is asserted to
 *               exist and to hold files.
 *   COMMENTS  — the fix's own docblock names `providerMessageId` four times and
 *               quotes the constraint error verbatim. A raw-text census reads
 *               those and answers about prose. Comments AND string-literal text
 *               are blanked before anything is parsed, length-preservingly, so
 *               every offset stays honest.
 */

const dbPackageDir = new URL("../../../packages/db/", import.meta.url);
const seedPath = fileURLToPath(new URL("scripts/seed-demo.mjs", dbPackageDir));
const rawSeed = readFileSync(seedPath, "utf8");

/**
 * Comments, and the TEXT of string literals, blanked to spaces — same length
 * and same line breaks, so an offset in the result is an offset in the original.
 *
 * `${…}` interpolations are KEPT, because that is where the company id lives.
 * Blanking literal text is not belt-and-braces: without it the three `https://`
 * URLs in this script open line comments that swallow the code after them, and a
 * string merely mentioning a field would read as an assignment to it.
 */
export function codeOnly(source: string): string {
  const out = source.split("");
  const blank = (i: number) => {
    if (out[i] !== undefined && out[i] !== "\n") out[i] = " ";
  };
  type State = "code" | "line" | "block" | "single" | "double" | "template";
  let state: State = "code";
  // One entry per open `${`, holding the brace depth inside it, so a `}` can
  // tell "the interpolation ends" from "an object literal ends".
  const interpolations: { depth: number }[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const d = source[i + 1];
    if (state === "code") {
      if (c === "/" && d === "/") { blank(i); blank(i + 1); state = "line"; i += 2; continue; }
      if (c === "/" && d === "*") { blank(i); blank(i + 1); state = "block"; i += 2; continue; }
      if (c === "'") { blank(i); state = "single"; i += 1; continue; }
      if (c === '"') { blank(i); state = "double"; i += 1; continue; }
      if (c === "`") { blank(i); state = "template"; i += 1; continue; }
      if (c === "{" && interpolations.length) {
        interpolations[interpolations.length - 1].depth += 1;
        i += 1;
        continue;
      }
      if (c === "}" && interpolations.length) {
        const top = interpolations[interpolations.length - 1];
        if (top.depth === 0) { interpolations.pop(); blank(i); state = "template"; i += 1; continue; }
        top.depth -= 1;
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === "line") {
      if (c === "\n") state = "code";
      else blank(i);
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") { blank(i); blank(i + 1); state = "code"; i += 2; continue; }
      blank(i);
      i += 1;
      continue;
    }
    if (state === "single" || state === "double") {
      if (c === "\\") { blank(i); blank(i + 1); i += 2; continue; }
      if (c === (state === "single" ? "'" : '"')) { blank(i); state = "code"; i += 1; continue; }
      blank(i);
      i += 1;
      continue;
    }
    // template
    if (c === "\\") { blank(i); blank(i + 1); i += 2; continue; }
    if (c === "`") { blank(i); state = "code"; i += 1; continue; }
    if (c === "$" && d === "{") {
      blank(i);
      blank(i + 1);
      interpolations.push({ depth: 0 });
      state = "code";
      i += 2;
      continue;
    }
    blank(i);
    i += 1;
  }
  return out.join("");
}

const seed = codeOnly(rawSeed);

// ------------------------------------------------------------------ the schema
//
// SCOPE, from the one place that cannot disagree with Prisma: the `prisma` block
// in packages/db/package.json. The schema is multi-file (CLAUDE.md's migrations
// trap), so a hand-written file list would silently stop covering a new one.
const dbPackageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("package.json", dbPackageDir)), "utf8"),
) as { prisma?: { schema?: string } };
const schemaFolder = dbPackageJson.prisma?.schema ?? null;
const schemaDir = schemaFolder ? fileURLToPath(new URL(`${schemaFolder}/`, dbPackageDir)) : null;

function schemaFiles(): { name: string; source: string }[] {
  if (!schemaFolder || !schemaDir || !existsSync(schemaDir)) {
    throw new Error(
      `packages/db/package.json names "${schemaFolder}" as the Prisma schema folder ` +
        "and nothing is there. NOTHING WAS SCANNED, which is not the same as nothing being wrong.",
    );
  }
  const files = readdirSync(schemaDir)
    .filter((name) => name.endsWith(".prisma"))
    .sort()
    .map((name) => ({ name, source: readFileSync(`${schemaDir}${name}`, "utf8") }));
  if (files.length === 0) {
    throw new Error(`${schemaFolder} holds no .prisma files, so this census scanned nothing.`);
  }
  return files;
}

/** A field-level `@unique` — the kind the DATABASE enforces across every row. */
type UniqueField = { model: string; field: string; file: string };

function singleFieldUniques(): UniqueField[] {
  const found: UniqueField[] = [];
  for (const { name, source } of schemaFiles()) {
    let model: string | null = null;
    for (const raw of source.split("\n")) {
      const line = raw.replace(/\/\/.*$/, "");
      const opens = line.match(/^model\s+(\w+)\s*\{/);
      if (opens) { model = opens[1]; continue; }
      if (/^\}/.test(line)) { model = null; continue; }
      if (!model) continue;
      // `@@unique([a, b])` is a COMPOSITE and a different animal: one carrying
      // companyId cannot collide across companies at all, which is why only
      // single-field uniques are in scope here.
      if (line.includes("@@unique")) continue;
      const field = line.match(/^\s*(\w+)\s+\S+.*?@unique/);
      if (field) found.push({ model, field: field[1], file: name });
    }
  }
  return found;
}

/** Counted WITHOUT the regex above — plain string splits, so the two can disagree. */
function uniqueOccurrences(): number {
  let total = 0;
  for (const { source } of schemaFiles()) {
    total += source.split("@unique").length - 1 - (source.split("@@unique").length - 1);
  }
  return total;
}

// -------------------------------------------------------- the seed's writes
//
// Every `prisma.<model>.<op>(` in the script, writes and reads alike. Reads are
// parsed too and then ignored, on purpose: `undo()` deletes by `jobId`, and
// without that call site in the list its `jobId:` would be attributed to
// whatever CREATE happened to come before it and judged as a write.
const WRITE_OPS = new Set(["create", "createMany", "upsert", "update", "updateMany"]);

type CallSite = { at: number; model: string; op: string };

function callSites(): CallSite[] {
  return [...seed.matchAll(/prisma\.(\w+)\.(\w+)\(/g)].map((m) => ({
    at: m.index ?? -1,
    model: m[1],
    op: m[2],
  }));
}

/** The client's own helpers — `$transaction`, `$disconnect`. Not model calls. */
function clientCalls(): number {
  return [...seed.matchAll(/prisma\.\$(\w+)\(/g)].length;
}

const lowerFirst = (name: string) => name[0].toLowerCase() + name.slice(1);

/**
 * Where a field is assigned inside a write payload for a given model.
 *
 * Attribution is "the nearest preceding `prisma.…(`", the same technique
 * scratch-cleanup-order.test.ts uses. The value is read to the end of its line,
 * which is how this script writes every one of them.
 */
function assignmentsIn(
  model: string,
  field: string,
): { op: string; expression: string; source: string; line: number }[] {
  const sites = callSites();
  const needle = `${field}:`;
  const found: { op: string; expression: string; source: string; line: number }[] = [];
  let cursor = 0;
  for (;;) {
    const at = seed.indexOf(needle, cursor);
    if (at === -1) break;
    cursor = at + 1;
    // A key, not a member expression or a longer identifier ending the same way.
    const before = seed[at - 1] ?? "";
    if (/[\w.$]/.test(before)) continue;
    const site = [...sites].reverse().find((s) => s.at < at);
    if (!site || site.model !== lowerFirst(model)) continue;
    const endOfLine = seed.indexOf("\n", at);
    const from = at + needle.length;
    const to = endOfLine === -1 ? undefined : endOfLine;
    const tidy = (text: string) => text.trim().replace(/,$/, "");
    found.push({
      op: site.op,
      // Judged on the code-only text, so a literal that merely SAYS
      // "company.id" cannot pass as scoped.
      expression: tidy(seed.slice(from, to)),
      // Quoted back at the reader from the ORIGINAL, which is only possible
      // because the blanking preserves length: the same offsets cut the same
      // characters out of both. A failure printing
      // `wentOut ?      MARK    toAddress` is one somebody has to decode
      // before they can act on it.
      source: tidy(rawSeed.slice(from, to)),
      line: rawSeed.slice(0, at).split("\n").length,
    });
  }
  return found.filter((f) => WRITE_OPS.has(f.op));
}

/**
 * Is a value the seed writes into a globally unique column safe across
 * companies?
 *
 *   "generated id"   the expression carries some row's `.id` — a cuid, unique by
 *                    construction, so two companies cannot produce the same one.
 *                    `company.id` is the narrowest case of this and is named
 *                    separately because it is the one the fix added.
 *   otherwise        built from constants and per-company values, which is
 *                    exactly what `demo-<MARK>-<address>-<day>` was.
 *
 * Judged on the code-only text, so a literal that merely SAYS "company.id"
 * cannot pass — the string's characters are blanked and only `${…}` survives.
 */
function scopeOf(expression: string): "company.id" | "generated id" | "unscoped" {
  if (/\bcompany\.id\b/.test(expression)) return "company.id";
  if (/\b[A-Za-z_$][\w$]*\.id\b/.test(expression)) return "generated id";
  return "unscoped";
}

/**
 * EVERY single-field `@unique` on a model this seed writes, with the verdict for
 * each — pinned here rather than derived from the file it checks.
 *
 * Six, and the boring five matter as much as the one that broke: they are the
 * evidence that the intersection was taken rather than a bug being patched where
 * it happened to show. A seventh row appearing — a newly seeded model carrying a
 * globally unique field — fails the first test by name, which is the point. That
 * is a decision somebody must make on purpose, not a set that grows quietly.
 */
const GLOBALLY_UNIQUE_ON_SEEDED_MODELS: {
  model: string;
  field: string;
  file: string;
  verdict: "never written" | "company.id" | "generated id";
  why: string;
}[] = [
  {
    model: "BidInvitation",
    field: "wonJobId",
    file: "estimating.prisma",
    verdict: "never written",
    why: "the seed's invitations are open or lost; nothing sets the won job, so it stays null",
  },
  {
    model: "Contact",
    field: "portalToken",
    file: "company.prisma",
    verdict: "never written",
    why: "a bearer credential — the seed never mints one, and null does not collide under a unique index",
  },
  {
    model: "CrewMember",
    field: "linkedUserId",
    file: "crew.prisma",
    verdict: "never written",
    why: "seeded crew have no login, so no user row to link",
  },
  {
    model: "OutboundMessage",
    field: "providerMessageId",
    file: "messaging.prisma",
    verdict: "company.id",
    why: "THE BUG. A provider's own id, globally unique by design, so the demo stand-in has to carry the company",
  },
  {
    model: "OutboundMessageEvent",
    field: "providerEventId",
    file: "messaging.prisma",
    verdict: "never written",
    why: "the seeded delivery events are ours, not a provider's; the field stays null",
  },
  {
    model: "WarrantyPeriod",
    field: "jobId",
    file: "operations.prisma",
    verdict: "generated id",
    why: "one warranty per job, and the id is a cuid from a job this run created — unique without help",
  },
];

group("the blanker is honest before anything is parsed with it", () => {
  it("keeps every offset, and keeps interpolations while dropping literal text", () => {
    const sample = [
      'const a = "https://example.com//not-a-comment"; // gone',
      "const b = `demo-${MARK}-${company.id}-x`;",
      "/* also gone: providerMessageId: nothing */",
      "const c = `${obj.fn({ deep: 1 })} tail`;",
    ].join("\n");
    const out = codeOnly(sample);
    expect(out).toHaveLength(sample.length);
    expect(out.split("\n")).toHaveLength(sample.split("\n").length);
    // The URL's `//` did not eat the rest of its line; the real comment did go.
    expect(out).toContain("const a = ");
    expect(out).not.toContain("gone");
    // Interpolations survive, literal text does not.
    expect(out).toContain("MARK");
    expect(out).toContain("company.id");
    expect(out).not.toContain("demo-");
    // A `}` closing an object inside `${…}` must not end the interpolation early.
    expect(out).toContain("obj.fn");
    expect(out).not.toContain("tail");
  });

  it("removes the mentions of the field that made a raw census meaningless", () => {
    // Not hypothetical: the fix's docblock names `providerMessageId` several
    // times and quotes the constraint error. A raw-text census answers about
    // those; this one must see exactly the one assignment.
    const rawMentions = rawSeed.split("providerMessageId").length - 1;
    const codeMentions = seed.split("providerMessageId").length - 1;
    expect(rawMentions).toBeGreaterThan(codeMentions);
    expect(codeMentions).toBe(1);
  });
});

group("the derived sets are the size they should be", () => {
  it("walks the schema folder Prisma itself is pointed at", () => {
    expect(schemaFolder).toBe("prisma/schema");
    const files = schemaFiles();
    expect(files.length).toBeGreaterThanOrEqual(40);
    // A file per name, all readable, none empty — a glob resolving to nothing
    // is the one failure a size check downstream cannot see.
    for (const file of files) expect(file.source.length).toBeGreaterThan(0);
  });

  it("attributes every `@unique` in the schema to a model and a field", () => {
    // Counted two ways that share no pattern. A regex that stops matching makes
    // these disagree instead of shrinking the set in silence.
    expect(singleFieldUniques()).toHaveLength(uniqueOccurrences());
    expect(uniqueOccurrences()).toBeGreaterThan(0);
  });

  it("attributes every `prisma.` in the seed to a call site", () => {
    const occurrences = seed.split("prisma.").length - 1;
    const attributed = callSites().length + clientCalls();
    // `const prisma = new PrismaClient()` is a declaration, not a use.
    expect(occurrences - attributed).toBe(0);
    expect(callSites().length).toBeGreaterThan(100);
  });

  it("finds writes for every model in the pinned list", () => {
    // The list is only meaningful if the seed really does write these models.
    // Without this, a model dropped from the seed would leave a row here that
    // quietly checks nothing.
    const written = new Set(callSites().filter((s) => WRITE_OPS.has(s.op)).map((s) => s.model));
    for (const row of GLOBALLY_UNIQUE_ON_SEEDED_MODELS) {
      expect(written, `the seed no longer writes ${row.model}`).toContain(lowerFirst(row.model));
    }
  });
});

group("no globally unique value the seed writes can collide across companies", () => {
  it("knows exactly which fields are in question", () => {
    const written = new Set(callSites().filter((s) => WRITE_OPS.has(s.op)).map((s) => s.model));
    const intersection = singleFieldUniques()
      .filter((u) => written.has(lowerFirst(u.model)))
      .map((u) => `${u.model}.${u.field} (${u.file})`)
      .sort();
    // Pinned. A seventh entry is a new seeded model carrying a field the
    // DATABASE requires to be unique across every company on it — the exact
    // shape that cost a half-finished demo set — and it fails here, by name,
    // rather than at message 1 of 6 on somebody's database.
    expect(intersection).toEqual(
      GLOBALLY_UNIQUE_ON_SEEDED_MODELS.map((r) => `${r.model}.${r.field} (${r.file})`).sort(),
    );
  });

  it("writes each of them scoped, or does not write it at all", () => {
    for (const row of GLOBALLY_UNIQUE_ON_SEEDED_MODELS) {
      const assignments = assignmentsIn(row.model, row.field);
      if (row.verdict === "never written") {
        expect(
          assignments,
          `${row.model}.${row.field} is recorded as never written (${row.why}) and the seed now writes it. ` +
            "Decide whether the value is unique across companies, then update the verdict.",
        ).toEqual([]);
        continue;
      }
      expect(
        assignments.length,
        `${row.model}.${row.field} is recorded as written and no assignment was found — ` +
          "either the seed stopped writing it or the parse is broken.",
      ).toBeGreaterThan(0);
      for (const assignment of assignments) {
        expect(
          scopeOf(assignment.expression),
          `${row.model}.${row.field} at seed-demo.mjs:${assignment.line} is globally unique in the ` +
            `database and is written as \`${assignment.source}\`, which carries nothing unique ` +
            "across companies. Seeding a second company on one database will collide here and die " +
            "part-way, leaving a partial demo set the reseed guard then refuses to replace. " +
            "Put `company.id` in it.",
        ).toBe(row.verdict);
      }
    }
  });

  it("the message stand-in carries the company, which is the fix itself", () => {
    // Spelled out as well as derived. The derivation above is what lasts; this
    // is the one line a reader of this file wants to see, and it fails on its
    // own if somebody takes the interpolation back out.
    const assignments = assignmentsIn("OutboundMessage", "providerMessageId");
    expect(assignments).toHaveLength(1);
    expect(assignments[0].source).toContain("${company.id}");
    expect(assignments[0].expression).toContain("company.id");
  });
});
