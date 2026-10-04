import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A MACHINE-READ SIGNAL MAY NOT ARRIVE PRE-REVIEWED.
 *
 * `qualify` counts only CONFIRMED signals, and the reason is in
 * `sales.prisma`'s own words — *"so research nobody has read can never make a
 * prospect look better than a prospect nobody researched."* The listing reader
 * produces signals by the dozen off one pasted page. If any of them landed
 * CONFIRMED, the band would measure how much reading happened rather than what
 * anybody knows, and the one number on the screen that decides a morning would
 * be the easiest number in the app to inflate.
 *
 * `createSalesLeadSignal` legitimately forces `CONFIRMED` and stamps the
 * reviewer, because a person typing a signal in IS the review. The two paths
 * sit in the same file, four hundred lines apart, and the difference between
 * them is one property name — which is exactly the kind of difference that gets
 * tidied away by somebody factoring out a shared helper.
 *
 * ── WHY THIS IS A SOURCE CENSUS AND NOT A DATABASE TEST ──
 *
 * A dbtest would be better evidence and this should grow one. But the defect
 * being guarded is a WRITE that is wrong in a way the row itself cannot reveal
 * once written: a CONFIRMED signal nobody confirmed looks exactly like a signal
 * somebody confirmed. Reading the write site is the cheap check that runs on
 * every push, and it is the one that catches the refactor.
 *
 * ── HOW IT KEEPS ITSELF HONEST ──
 *
 * Three ways, because a census that cannot fail is worse than no census:
 *
 *  1. **Comments are stripped before anything is matched.** Both functions
 *     discuss `CONFIRMED` in their own headers — this very file's reasoning is
 *     quoted in one of them — so a raw-text scan would fail on prose and then
 *     be "fixed" by deleting the explanation. That is the #185 shape: a comment
 *     quoting the pattern disarming the census.
 *  2. **Both function bodies must be non-empty.** This is the one that carries
 *     the vacuity, and it is the one proved by mutation: renaming
 *     `importSubListing` makes the slice resolve to `""`, every `.test()` below
 *     returns false, and four assertions go red — where without it the file
 *     would pass having examined nothing. Nothing is ever missing from an empty
 *     string.
 *  3. **There is a control on the PREMISE.** `createSalesLeadSignal` must still
 *     be seen setting CONFIRMED — not because that detects a blind detector
 *     (assertion 2 does that), but because the whole argument here rests on two
 *     write paths differing deliberately. If the hand-typed path stops
 *     confirming, the convention has changed and these rules need rereading
 *     rather than enforcing.
 *
 *     That distinction is written out because the first version of this comment
 *     claimed the control caught detector blindness, and the mutation written to
 *     prove it — splitting the literal as `("CONFI" + "RMED") as "CONFIRMED"` —
 *     passed, since the string is still right there in the type assertion. The
 *     control was fine; the sentence describing it was wrong, which is the more
 *     dangerous of the two.
 */

const salesActions = fileURLToPath(new URL("../actions/sales.ts", import.meta.url));

/** Line comments and block comments out; string literals kept. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

/**
 * The body of one exported action, from its signature to the next top-level
 * `export ` at column zero. Crude on purpose: a real parser here would be a
 * second thing to get wrong, and the assertion below that the slice is
 * non-empty is what makes the crudeness safe.
 */
function bodyOf(code: string, name: string): string {
  const start = code.indexOf(`export async function ${name}(`);
  if (start === -1) return "";
  const after = code.slice(start + 1);
  const end = after.indexOf("\nexport ");
  return end === -1 ? after : after.slice(0, end);
}

const source = stripComments(readFileSync(salesActions, "utf8"));
const importer = bodyOf(source, "importSubListing");
const byHand = bodyOf(source, "createSalesLeadSignal");

describe("the listing reader proposes, it never confirms", () => {
  it("found both write paths, so neither assertion is about an empty string", () => {
    expect(importer.length, "importSubListing was not found in lib/actions/sales.ts").toBeGreaterThan(
      500,
    );
    expect(byHand.length, "createSalesLeadSignal was not found in lib/actions/sales.ts").toBeGreaterThan(
      200,
    );
  });

  /**
   * The positive control. If this goes red the detector has stopped working and
   * every other assertion in this file has become vacuous.
   */
  it("still detects the hand-typed path setting CONFIRMED", () => {
    expect(
      /CONFIRMED/.test(byHand),
      "createSalesLeadSignal no longer sets CONFIRMED — either the convention changed or this census can no longer see it, and until that is settled nothing below means anything",
    ).toBe(true);
  });

  it("does not set CONFIRMED anywhere in the importer", () => {
    expect(
      /CONFIRMED/.test(importer),
      "importSubListing mentions CONFIRMED. A signal nobody has read must not count toward a band.",
    ).toBe(false);
  });

  it("sets PROPOSED explicitly rather than relying on the column default", () => {
    // The default is PROPOSED, so omitting it would also be correct — but then
    // a reader of this function cannot tell whether that was decided or
    // forgotten, and a schema change would silently change behaviour here.
    expect(/state:\s*"PROPOSED"/.test(importer)).toBe(true);
  });

  it("stamps no reviewer, because nobody reviewed it", () => {
    expect(
      /reviewedByUserId/.test(importer),
      "importSubListing names reviewedByUserId. Nothing it writes was reviewed by a person.",
    ).toBe(false);
    expect(/reviewedAt/.test(importer)).toBe(false);
  });

  it("does not reach the hand-typed action, which would carry the stamp with it", () => {
    expect(/createSalesLeadSignal\s*\(/.test(importer)).toBe(false);
  });
});

describe("the reader is actually wired up", () => {
  /**
   * The "written, documented, and never called" guard. `signalsForSub` is where
   * every claim sentence is decided, so a version of this feature that imported
   * the parser and built its own claims would typecheck, test green, and quietly
   * bypass every rule in `signals.ts`.
   */
  it("builds its claims with signalsForSub rather than its own sentences", () => {
    expect(/signalsForSub\s*\(/.test(importer)).toBe(true);
  });

  it("re-parses the pasted text on the server rather than trusting the screen", () => {
    expect(/parseSubListing\s*\(/.test(importer)).toBe(true);
  });
});
