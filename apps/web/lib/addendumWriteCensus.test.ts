import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe as group, expect, it } from "vitest";

/**
 * READING AN ADDENDUM WRITES NOTHING ANY OTHER MODULE READS.
 *
 * That sentence is the whole design. It is in `bid-addenda.prisma`, in
 * `actions/addendumRead.ts`, in the `AiFeature` enum's own comment, in the
 * changelog and in the PR. Until now it was asserted nowhere.
 *
 * ── WHY IT NEEDED ITS OWN GUARD ──
 *
 * A browser click-through tried to confirm it and COULD NOT. The instruction was
 * "check the 'Changed work we had already priced' checkbox is still unticked",
 * and the tester reported: "The addendum row doesn't show the checkbox at all."
 * They were right — `BidCompliance.tsx` renders that flag only when it is TRUE,
 * so its false state is invisible by design and the promise is unfalsifiable from
 * the screen.
 *
 * A promise nobody can check is the thing this repo distrusts most. So it is
 * checked here instead.
 *
 * ── THE FOUR FIELDS, AND WHY EACH ONE MATTERS ──
 *
 *   affectsPricedScope — `takeoff-currency-query.ts` selects addenda WHERE this
 *     is true, to warn that a job's measurements came off superseded paper.
 *     Writing it moves a warning on a job somebody may be building from.
 *   acknowledgedOn — a legal assertion on a document the GC holds you to.
 *     `ask/commands/estimating.ts` refuses it to the assistant in as many words.
 *   issuedOn — the date `takeoff-currency.ts` compares to decide supersession.
 *   dueDate — the bid deadline on `BidInvitation`.
 *
 * ── WHAT THIS PROVES, AND WHAT IT DOES NOT ──
 *
 * It reads SOURCE. It proves no file in the addendum-reading feature contains a
 * write to those fields, which is the realistic regression: somebody adds a
 * convenience "and tick the box for them" later, reasonably, without knowing why
 * it was refused. It does NOT prove the running code cannot reach such a write
 * through something it calls — that would need the action driven against a
 * database with the model stubbed, and the fetch inside it makes that a harness
 * rather than a test. Stated plainly rather than implied, because a guard that
 * oversells itself is worse than one that does not exist.
 */

const ROOT = new URL("../", import.meta.url).pathname;

/** The feature's own files. Listed as PATHS rather than found by a pattern,
 *  because "every file matching *addend*" would silently stop covering a file
 *  somebody renames — and the size assertion below is what catches that. */
const FEATURE_FILES = [
  "lib/actions/addendumRead.ts",
  "lib/addenda-overlap.ts",
  "lib/ask/addendumSpend.ts",
  "lib/addenda-acknowledgement.ts",
  "components/AddendumFindings.tsx",
];

/** Columns this feature must never assign. */
const FORBIDDEN = ["affectsPricedScope", "acknowledgedOn", "issuedOn", "dueDate"];

/**
 * A `type` or `interface` body, removed.
 *
 * A FIELD IN A TYPE IS A SHAPE, NOT A WRITE. `addenda-acknowledgement.ts` reads
 * `acknowledgedOn` and `affectsPricedScope` and assigns neither — but it has to
 * DECLARE them to take a row, and `acknowledgedOn: string | null` inside a type
 * matches a pattern looking for `field:`.
 *
 * This is the narrowing the census itself asks for: *"the right response is to
 * narrow this pattern on purpose rather than to widen the list of exempt
 * files"*. Same move as stripping comments one level along, and it is held by
 * the mutation below — an assignment put back into any of these files still
 * fails, type declarations or not.
 */
function withoutTypeBodies(text: string): string {
  let out = "";
  let at = 0;
  const declaration = /\b(?:export\s+)?(?:type\s+\w+\s*=\s*\{|interface\s+\w+\s*\{)/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(text)) !== null) {
    out += text.slice(at, match.index);
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < text.length && depth > 0) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") depth -= 1;
      i += 1;
    }
    at = i;
    declaration.lastIndex = i;
  }
  return out + text.slice(at);
}

function source(rel: string): string {
  const text = readFileSync(join(ROOT, rel), "utf8");
  // Comments stripped, and it is load-bearing here rather than tidy: every one
  // of these files NAMES the forbidden fields in prose, at length, explaining
  // why they are not written. A raw-text census would fail on the very comments
  // that document the rule — #185's scar, a census disarmed by a comment
  // quoting its own pattern, arriving from the opposite direction.
  return withoutTypeBodies(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
}

group("the addendum reader writes nothing another module reads", () => {
  it("has every file it claims to check", () => {
    // A path that stops existing would make its loop iteration vacuous, and this
    // census would go green having read three files instead of four.
    for (const rel of FEATURE_FILES) {
      expect(statSync(join(ROOT, rel)).isFile(), `${rel} exists`).toBe(true);
    }
    expect(FEATURE_FILES.length).toBeGreaterThanOrEqual(4);
  });

  it("covers every file the feature actually has", () => {
    // THE SCOPE ASSERTION. `theme-contrast.test.ts` had the right pattern and the
    // wrong scope — nothing is ever missing from a directory you do not walk — so
    // the list above is checked against what is on disk. A fifth addendum file
    // added later fails this until somebody decides whether it belongs.
    const found: string[] = [];
    for (const dir of ["lib", "lib/actions", "lib/ask", "components"]) {
      for (const name of readdirSync(join(ROOT, dir))) {
        if (!/addend/i.test(name)) continue;
        if (/\.(test|dbtest|eval)\./.test(name)) continue;
        if (name.endsWith(".ts") || name.endsWith(".tsx")) found.push(`${dir}/${name}`);
      }
    }
    const uncovered = found.filter((f) => !FEATURE_FILES.includes(f));
    expect(uncovered, `addendum files this census does not check: ${uncovered.join(", ")}`).toEqual([]);
  });

  it("assigns none of the four fields anywhere", () => {
    const offences: string[] = [];
    for (const rel of FEATURE_FILES) {
      const text = source(rel);
      for (const field of FORBIDDEN) {
        // `field:` in ANY object literal, or `field =`. DELIBERATELY BLUNTER
        // THAN "an assignment": it cannot tell `data: { x: true }` from
        // `where: { x: true }`, so a legitimate filter on one of these columns
        // would fail this census too.
        //
        // That is the conservative direction and it is chosen. A false positive
        // is a build failure a person resolves by reading the message; a false
        // negative is a model moving a supersession warning on a job somebody is
        // building from. If this feature ever genuinely needs to READ addenda
        // filtered by `affectsPricedScope`, the right response is to narrow this
        // pattern on purpose rather than to widen the list of exempt files.
        const assigns = new RegExp(`\\b${field}\\s*[:=](?!=)`);
        if (assigns.test(text)) offences.push(`${rel} assigns ${field}`);
      }
    }
    expect(
      offences,
      `${offences.join("; ")} — reading an addendum must write none of these. ` +
        `affectsPricedScope moves a supersession warning on a job somebody may be building from; ` +
        `acknowledgedOn is a legal assertion on a document the GC holds you to; issuedOn is what ` +
        `takeoff-currency compares; dueDate is the bid deadline. If this is a deliberate change, ` +
        `bid-addenda.prisma and lib/ask/commands/estimating.ts both have to change with it.`,
    ).toEqual([]);
  });

  it("can fail — the pattern finds a write when there is one", () => {
    // Mutation-proving the matcher itself, inline, because a census whose regex
    // silently matches nothing passes every assertion above it.
    const assigns = (field: string) => new RegExp(`\\b${field}\\s*[:=](?!=)`);
    expect(assigns("affectsPricedScope").test("data: { affectsPricedScope: true }")).toBe(true);
    expect(assigns("acknowledgedOn").test("acknowledgedOn = new Date()")).toBe(true);
    // It does NOT fire on a comparison, which is what a read usually looks like
    // and which several of these files legitimately do.
    expect(assigns("issuedOn").test("if (addendum.issuedOn === null) return")).toBe(false);
    expect(assigns("issuedOn").test("row.issuedOn")).toBe(false);
    // But it DOES fire on an object key, so a `where` or a `select` on one of
    // these columns trips it as well. Pinned as the documented trade rather than
    // left to be discovered: blunt on purpose, in the safe direction.
    expect(assigns("affectsPricedScope").test("where: { affectsPricedScope: true }")).toBe(true);
    expect(assigns("dueDate").test("select: { dueDate: true }")).toBe(true);
  });
});
