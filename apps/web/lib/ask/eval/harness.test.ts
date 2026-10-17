import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The guard on the guard.
 *
 * `requireApiKey()` is what stops an eval passing on nothing: without a
 * key, a run of zero cases and a run of a hundred look identical in a
 * terminal, and the first one reads as a clean bill. The failure mode of
 * that guard is not that it breaks — it is that the NEXT eval somebody
 * writes does not call it, which nothing would notice.
 *
 * So this walks the directory rather than a list. "Nothing is ever missing
 * from a directory you do not walk", and a list of eval files to check
 * would be a list somebody has to remember to add to, which is the same
 * bug one level up.
 *
 * ── AND IT WALKED THE WRONG DIRECTORY, WHICH IS THE DEFECT THE PARAGRAPH
 *    ABOVE INVOKES BY NAME ──
 *
 * Corrected 2026-10-02. `DIR` was `join(import.meta.dirname, ".")` — this
 * folder, `lib/ask/eval/`, which holds TWO of the repo's eval files. The other
 * six live beside the features they measure (`lib/estimating/`,
 * `lib/plan-ingest/`, `lib/quote-read/`, `lib/leads/`, `lib/research/`,
 * `lib/addenda/`) and were outside the walk entirely. All six happen to call
 * `requireApiKey()`, which is exactly why nobody noticed: the guard was green
 * and it was green about two files.
 *
 * This is `theme-contrast.test.ts` and `packages/ui/Button.tsx` again — right
 * pattern, wrong scope — and no size assertion can catch it, because a file
 * outside the walk is not a small set, it is not in the set at all. The comment
 * above makes it worse rather than better: it cites the rule it was breaking,
 * which is the shape that stops a reader looking.
 *
 * So the walk is now the whole of `lib/`, recursively, and the count is
 * asserted against the number of eval files that actually exist. A new eval
 * written anywhere under `lib/` is covered with no edit here.
 */
const LIB = join(import.meta.dirname, "..", "..");

function evalFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...evalFiles(full));
    else if (entry.name.endsWith(".eval.ts")) found.push(full);
  }
  return found;
}

describe("every eval refuses to run without a key", () => {
  const files = evalFiles(LIB);

  it("finds the eval files at all, across the WHOLE of lib", () => {
    // The size assertion. A pattern that matches nothing passes every
    // downstream check in the loop below, since nothing is ever missing
    // from an empty list — CLAUDE.md, the SQL guard that went green on 180
    // of 181 foreign keys.
    //
    // The floor is 8 rather than 2 deliberately: 2 was satisfiable by this
    // folder alone, so it could not have noticed the scope bug above. A floor
    // that the OLD scope cannot reach is what makes the fix stick.
    expect(files.length).toBeGreaterThanOrEqual(8);
    // And the walk must leave this folder, which is the specific thing that
    // was wrong. At least one eval outside `lib/ask/eval/`.
    expect(files.some((file) => !file.includes(join("ask", "eval")))).toBe(true);
  });

  /**
   * THE EVALS THAT CALL NO MODEL, named rather than detected.
   *
   * This guard's real property is that **an eval must not pass on nothing**. For
   * an eval that calls a model, an API-key check at collection is how that is
   * guaranteed: without a key it refuses instead of scoring zero cases.
   *
   * `scaleAudit.eval.ts` calls no model. It is deterministic geometry over
   * drawings somebody points it at, so there is no key to demand and demanding
   * one would be theatre. It makes the SAME guarantee by other means, and the
   * loop below asserts both halves rather than taking the exemption on trust:
   * it SKIPS when given no input, and when given input it asserts the input
   * resolved to something before reading a figure off the run.
   *
   * Detecting "calls a model" was tried and rejected as the discriminator:
   * `@prova/integrations` is imported by eight of these files and NOT by the two
   * in this folder, which do call a model. A named exemption with its own
   * assertions is the pattern `clerkMountGate.test.ts` uses for `/sign-in` and
   * `/sign-up`, and for the same reason — an exemption nobody checks is a hole,
   * and one the guard re-proves is a second kind of guarantee.
   */
  const KEYLESS_EVALS: Record<string, string> = {
    "scaleAudit.eval.ts":
      "calls no model: deterministic geometry over real drawings, guarded by a skip plus a non-zero input assertion",
    "takeoffBench.eval.ts":
      "calls no model: generated drawings through the real scale/wall/schedule pipeline, guarded by a skip plus non-zero case and path-operator assertions",
    "realPlan.eval.ts":
      "calls no model: a REAL plan set from outside the repo through the same deterministic path, guarded by a skip on REAL_PLAN_PDF plus a non-zero segment assertion — a scanned sheet returns none and must not read as a clean run",
    "layers.eval.ts":
      "calls no model: reads optional-content group names straight off a REAL plan set to answer whether architects' exports name their layers at all, guarded by a skip on REAL_PLAN_PDF plus a non-zero page assertion — a mistyped path must not read as 'no set has layers', which is the one finding that would abandon the approach",
    "extract.eval.ts":
      "calls no model: reads the TEXT LAYER of twenty committed fixtures and writes the answer key from what each drawing prints, guarded by a skip when the fixtures are absent plus a non-zero file assertion — a key built from no files would be an empty key that scores everything as unknown",
    "benchMultiView.eval.ts":
      "calls no model: splits the bench's A-401 — two drawings at two scales plus one at NTS — and prints each view's scale and footage beside the single-scale baseline, so the split can be read against per-wall ground truth. Guarded by a skip when the bench PDFs are absent, plus an assertion that at least one A-401 PDF was found",
    "realSheets.eval.ts":
      "calls no model: walks a FOLDER of real plan sets named by REAL_PLAN_DIR, picks the floor plans from what each sheet's own title block says, and runs the product's wall pipeline on them. The drawings are a client's confidential documents and stay outside the repository — this file reads them in place, writes its report to REAL_PLAN_OUT, copies nothing and derives no fixture. Guarded by a skip when REAL_PLAN_DIR is unset plus a non-zero PDF-count assertion, because a mistyped folder would otherwise report a clean nothing",
    "sheetTreeReal.eval.ts":
      "calls no model: reads every page's title block off five REAL plan sets with the glyph-height reader in `realplan/nameSheet.ts` — which is deterministic and keyless — and runs the product's own `buildSheetTree` over the result, to answer how many of 283 real sheets the grouping can place and why the rest cannot. The product's ingest reads a title block WITH a model; this deliberately does not, so its findings are about the GROUPING rather than about the model's reading. The drawings are a client's and stay outside the repository: read in place from REAL_PLAN_DIR, report and JSON sidecar written to REAL_PLAN_OUT, nothing copied and no fixture derived. Guarded by a skip when REAL_PLAN_DIR is unset, plus non-zero PDF-count and per-set page-count assertions, because a mistyped folder would otherwise report a clean nothing and '0 unfiled' would read as a perfect score",
    "scaleInvariance.eval.ts":
      "calls no model: measures S02 and S03 — one building drawn at 1/4\" and 1/8\" — through the real wall pipeline and requires the two totals to agree within 0.5%. It needs no key, because the comparison is between two runs of the same engine rather than against a truth. Guarded by a skip when the fixture PDFs are absent, plus a non-zero run-count assertion on BOTH sheets, because two sheets that produced nothing would agree perfectly",
    "truthScore.eval.ts":
      "calls no model: scores all 20 fixtures' wall footage against the GENERATOR'S OWN geometry in lib/takeoff/fixtures/truth — gross, net, the exterior/interior split, and per-wall misses and extras. The keys are the generator's export, not a measurement, and truthWall.test.ts keeps the engine from reading them. Guarded by a skip when the fixtures or the keys are absent, plus an assertion that a fixture was opened",
    "keyScore.eval.ts":
      "calls no model: scores all 20 fixtures against what their keys actually hold — scale (honouring scaleAuthority), room counts, and a floor derived from each sheet's own printed dimensions. Wall LF, doors and windows have NO key by design (expected.test.ts forbids one), so they are reported as absent rather than invented. Guarded by a skip when the fixture PDFs are absent, plus assertions that a fixture was opened and that at least one sheet could be checked against its printed dimensions",
    "sheetViews.eval.ts":
      "calls no model: splits each fixture sheet into its captioned views and measures each at its own scale, printing name/scale/band/footage per view. Guarded by a skip when the fixture PDFs are absent, plus assertions that a sheet was actually opened and that at least one sheet read as multi-view",
    "groups.eval.ts":
      "calls no model: prints the biggest connected candidate group per fixture with NO threshold applied, so a replacement for the run-count rule can be chosen from measurements. Guarded by a skip when the fixtures are absent plus a non-zero fixture assertion",
    "tesseract.eval.ts":
      "calls no model: prices a free OCR engine (tesseract.js, Apache-2.0) against the SAME bar the model was measured on — same scans, same tiles, same 30pt tolerance, same answer key from the vector originals. Guarded by a skip when the fixtures are absent plus a non-zero text assertion on each vector original, because a key built from no words would score any engine, including one that reads nothing, at a clean 100%",
    "tileSkip.eval.ts":
      "calls no model: measures whether a near-blank tile of a SCANNED sheet could be skipped to save a model call, by counting ink off the render and locating the real words in the vector drawing the scan was made from. Guarded by a skip when the fixtures are absent plus a non-zero text assertion on each vector original — a key built from no words would report every tile as skippable, which is the expensive direction to be wrong in",
    "raster.eval.ts":
      "calls no model: renders the three SCANNED fixtures and grades the lines it finds against the vector drawings they are scans of (S18 of S02, S19 of S08, S20 of S13), guarded by a skip when the fixtures are absent plus a path-operator assertion on each vector original — a scan graded against a drawing that yielded no geometry would score the detector perfect for finding nothing",
    "score.eval.ts":
      "calls no model: runs the deterministic pipeline over those fixtures and scores it against the printed answers, guarded by the same skip plus a non-zero key assertion and a non-zero stroke assertion — a clean table from a run that read no geometry is the vacuous green this directory exists to end",
    "stages.eval.ts":
      "calls no model: reports how many wall candidates survive each filter of findWallsOnSheet on a committed fixture, so 'this sheet found nothing' can be attributed to a stage rather than guessed at, guarded by a skip when the fixtures are absent plus a non-zero row assertion",
    "overlay.eval.ts":
      "calls no model: renders the detections over each fixture as a PNG so a failure can be looked at rather than reasoned about, guarded by the same skip plus an assertion that one image was written per fixture",
    "sheetTemplate.eval.ts":
      "calls no model: the template filter's recurrence histogram over a REAL set, guarded by a skip on REAL_PLAN_PDF plus a non-zero segment assertion — a sheet that parsed to nothing must not read as a sheet with no furniture on it",
  };

  it("NAMES EVERY KEYLESS EXEMPTION, and each one still exists", () => {
    // An exemption for a file that has been renamed or deleted is a hole left
    // open for whatever lands on that name next.
    for (const name of Object.keys(KEYLESS_EVALS)) {
      expect(
        files.some((file) => file.endsWith(name)),
        `${name} is exempted from the key check but no such eval exists any more — remove the exemption`,
      ).toBe(true);
    }
  });

  it("holds the keyless evals to the SAME promise by other means", () => {
    for (const name of Object.keys(KEYLESS_EVALS)) {
      const file = files.find((f) => f.endsWith(name));
      if (file === undefined) continue;
      const source = readFileSync(file, "utf8");

      // It must refuse to run on nothing rather than scoring a clean zero.
      expect(
        /describe\.skipIf\(/.test(source),
        `${name} is exempt from the key check but does not skip when it has no input — so with nothing ` +
          `set it would run and pass on nothing, which is the whole thing this guard exists to refuse`,
      ).toBe(true);

      // And when it IS given input, it must prove the input resolved to
      // something before reading any figure off the run. A mistyped folder name
      // otherwise produces no pages, no findings and a clean summary.
      expect(
        /expect\([^)]*\.length[\s\S]{0,200}?toBeGreaterThan\(0\)/.test(source),
        `${name} never asserts its input resolved to anything, so a path that matches no file would ` +
          `read as a clean run`,
      ).toBe(true);
    }
  });

  it("demands a key BEFORE any case runs, not inside one", () => {
    // ── WHAT THIS ASSERTS, AND WHY IT IS NOT THE OLD REGEX ──
    //
    // The old assertion was `/^requireApiKey\(\);$/m` — column zero, that exact
    // name. Rescoping the walk to all of `lib/` showed it was wrong about six
    // legitimate files: they call `requireEvalApiKey(...)` (the SHARED helper,
    // which also rejects the "…" placeholder, so it is the better one) from the
    // `describe` body, which vitest runs at COLLECTION, before any case. That
    // satisfies the real requirement.
    //
    // So the property is stated directly instead of by position: the check is
    // reached at collection, and is NOT inside an `it`. Indentation is not the
    // thing that matters; whether a case has already started is.
    const INSIDE_IT = /\bit\(\s*[\s\S]{0,400}?require(Eval)?ApiKey\s*\(/;

    for (const name of files) {
      // The keyless evals are held to the same promise two cases above, by the
      // means they actually have. See `KEYLESS_EVALS`.
      if (Object.keys(KEYLESS_EVALS).some((exempt) => name.endsWith(exempt))) continue;

      const source = readFileSync(name, "utf8");
      expect(
        /require(Eval)?ApiKey\s*\(/.test(source),
        `${name} never demands an API key, so without one it would pass on nothing`,
      ).toBe(true);

      // Reached at collection: either module scope, or inside a describe/group
      // body — both run before the first case.
      const atCollection =
        /^require(Eval)?ApiKey\(/m.test(source) || /^\s{2}require(Eval)?ApiKey\(/m.test(source);
      expect(
        atCollection,
        `${name} has a key check but not at collection scope. Put it at module scope or in the ` +
          `describe body — a check inside an \`it\` has already let the suite START, and a suite that ` +
          `starts and throws N times reads as a measurement that went badly rather than one that never ran.`,
      ).toBe(true);

      expect(
        INSIDE_IT.test(source),
        `${name} demands its key INSIDE an \`it\` body. See the message above: that is the one placement ` +
          `this guard exists to refuse.`,
      ).toBe(false);
    }
  });
});
