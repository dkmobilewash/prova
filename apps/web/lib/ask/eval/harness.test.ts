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
    "detectProfile.eval.ts":
      "calls no model: times `findWallsOnSheet` — deterministic geometry — on named sheets of REAL plan sets and reports where the seconds go, per stage. It exists because AUDIT.md recorded detection at 102 seconds and said to PROFILE it first rather than guess, and the guess everybody had was wrong: the quadratic pair test took 479ms and the curve assembly took 96% of the run. The drawings are a client's and stay outside the repository, read in place from REAL_PLAN_DIR. Guarded by a skip when REAL_PLAN_DIR is unset, plus an assertion that at least one sheet was actually profiled — a mistyped DETECT_PROFILE_SHEETS would otherwise print nothing and pass, which is a profile of nothing",
    "zzClasses.eval.ts":
      "calls no model: classifies the long lines the pairer could NOT pair on named REAL sheets — by pen weight against the sheet's own wall pen, by company (a hatch is many parallels), by composition (a dashed line is many collinear strokes), by position (past the walls' own box) and by closure — and writes one overlay per class. It changes no detection; it exists so an answer-key reviewer meets a handful of named groups rather than eight thousand feet of line, and it is what established that 93% of A102's unpaired footage is hatching. Reads in place from REAL_PLAN_DIR, writes overlays to REAL_PLAN_OUT, prints counts and pen widths only. Skips without the folder and asserts a sheet matched",
    "zzMissed.eval.ts":
      "calls no model: a TEMPORARY diagnostic for the missed-wall work — it walks the filter chain stage by stage on named REAL sheets and reports what each stage removed, then asks separately how many unclaimed long faces have a valid partner anywhere at all. The first version of it asked a worse question and answered it with an artefact (every heavy line is drawn as two coincident strokes, so its NEAREST parallel is always its own edge), which is recorded in its header. Reads in place from REAL_PLAN_DIR, writes nothing, prints feet and thicknesses only. Skips without that folder and asserts a sheet matched, so a mistyped selector fails rather than passing on nothing",
    "zzExtract.eval.ts":
      "calls no model: re-draws every bench sheet, runs the finder with the `onCandidate` hook, and writes one training row per candidate pairing to `EXTRACT_OUT` — the feature vector plus a label taken from the bench's own key by geometry, so no grader is reimplemented and no judgement is involved. It includes the ZERO-WALL sheets, where every candidate is a negative and where the errors this is aimed at live. Skips without `EXTRACT_OUT`, and asserts both that candidates were extracted at all and that some matched a key wall, because a run labelling nothing positive would train a model that says no to everything and score well on an unbalanced set",
    "zzOffsetWhy.eval.ts":
      "calls no model: asks whether the offset check's flags are its own fault, by looking up the CAD layer of every line in the face pair it chose — `layerNames.ts` already reads `S-GRID` and its relatives. Prints each sheet's layer coverage FIRST and reports a sheet with no layers as UNTESTABLE rather than as clean, which is what the ELEVEN03 exports turned out to be: 0% of 57,510 segments carry one, so the grid question cannot be asked of them at all. Skips without `REAL_PLAN_DIR` and `TAKEOFF_LABEL_DIR`; asserts at least one sheet was read",
    "zzPartitionText.eval.ts":
      "calls no model: prints the text of named pages grouped into lines, filtered to the ones mentioning an assembly word, so a partition legend can be READ before anything parses one. Written because `wallTags.ts` records a set with no partition schedule at all, so the shape of the text is not safe to assume. Skips without `REAL_PLAN_DIR` and `PT_SHEETS`; asserts at least one page was read",
    "zzWallTypeChain.eval.ts":
      "calls no model: walks one wall type from the tag beside a wall on Camp Bow Wow A101, through the partition legend's own words on A130, to proposed components and the quantities they produce. Takes the legend's lines directly because `SCHEDULE_ROWS` never runs on that sheet — it is a legend rather than a table, which `planSheets`' prompt types as OTHER. Skips without `REAL_PLAN_DIR`; asserts walls were found, components were produced, and that a run carrying a tag produced quantity lines",
    "zzOffset.eval.ts":
      "calls no model: measures how far each ACCEPTED run on a labelled sheet sits from the nearest full-length wall-face pair, to find candidates paired with a shelf or a shelf end instead of the wall's far face. Prints each flagged run's position in the saved verdicts array so a labeller's own numbering can be checked against the geometry rather than assumed. Skips without `REAL_PLAN_DIR` and `TAKEOFF_LABEL_DIR`; asserts both that something was flagged somewhere and, per sheet, that runs with a face pair were found at all — a coordinate-system mistake returns a clean empty list otherwise, which it did on the first run",
    "zzReady.eval.ts":
      "calls no model: one line per page saying which view the product picks, how many runs the finder offers and how much footage, to check a sheet is labellable before anybody opens it in a browser. Exists because `realSheets.eval.ts` only measures pages on its own fixed answer-key list and answers 'not on the fixed list' for every other. Skips without `REAL_PLAN_DIR` and `READY_SHEETS`; asserts at least one pairing was offered somewhere",
    "zzViewPick.eval.ts":
      "calls no model: prints, for every sheet carrying two or more views, each view's caption, what `takeoffRank` makes of it, whether it was measured and its footage, and which one `primaryView` picked. Written because HPL p3 carries finish, lighting and partition plans of one floor and the finder measured the LIGHTING plan. Skips without `REAL_PLAN_DIR`; asserts it found at least one sheet with two or more views, so a run that chose nothing fails instead of printing a clean empty list; names any sheet whose views or caption scales could not be read rather than skipping it silently",
    "zzA101Rebuild.eval.ts":
      "calls no model: rebuilds one sheet's label file from verdicts recovered elsewhere, applying a split to any accepted horizontal run that crosses the building's east wall. It exists because a scripted pass through the UI pressed Save on a fresh state and replaced 143 verdicts with 15 — the app cannot reload a saved review, so every re-save starts blank. It goes through `labelFile` and `writeLabels`, the same path the route uses, so what it writes is a file the app could have written. Skips without `REAL_PLAN_DIR` and `A101_VERDICTS`, and asserts both long walls were actually split rather than reporting a clean nothing",
    "zzA101Dup.eval.ts":
      "calls no model: runs the real finder over one named sheet of a client plan set, builds the real review state, and prints which candidates `startReview` pre-marked as one wall offered twice. It exists because `duplicateCandidates.test.ts` proves the rule against FIXTURES — numbers typed from a report — which is the right place for the boundaries and cannot say whether the rule fires on the candidates the sheet actually produces. Asserts that nothing three feet or more apart was called a duplicate, which is the failure that would delete real wall. Skips without `REAL_PLAN_DIR`",
    "zzA101.eval.ts":
      "calls no model: re-runs the finder over ONE named sheet of a client plan set (`REAL_PLAN_DIR`, `A101_SET`, `A101_PAGE`) and prints every run with its length, thickness, position and the runs that overlap it. It exists because the saved label file keeps derived pairing rows and, until this week, not the reviewer's own verdicts — so the questions that came back from the first real review (which of these two long east-wall runs is the same wall twice) had no list to answer them from. Writes `runs.json` to `A101_OUT`. Skips without `REAL_PLAN_DIR` and asserts a run was found, so a mistyped path fails rather than reporting a clean nothing",
    "zzBim.eval.ts":
      "calls no model: runs the finder over the BIM held-out sheets named by `BIM_DIR` — PDFs rendered from real IFC buildings whose answer key is the model's own centrelines rather than anyone's reading of a drawing — and scores missing / extra / net against them, TWICE, with furring counted and excluded, because whether a sub bills a thin finish layer as wall depends on the trade. Groups by renderer and by model, blames each missed wall on what it IS and each extra on what the key says it sits on, and writes overlays to `BIM_OUT`. TEST ONLY: training on these makes them stop measuring anything. Skips without `BIM_DIR` and asserts a sheet actually scored, so a mistyped path fails rather than reporting a clean nothing",
    "zzBimRead.eval.ts":
      "calls no model: counts the strokes our reader returns for each BIM sheet against the count the sheet's own key records, because a finder that cannot pair two faces and a reader that never hands it the faces look identical in a score. It settled exactly that question once — the reader returns 102.7% of what the keys record, so a missed BIM wall is never a reading failure. Skips without `BIM_DIR`",
    "zzMessy.eval.ts":
      "calls no model by default: runs the finder over the messy synthetic sheets named by `MESSY_DIR`, turns each sheet's key into label rows — every candidate pairing with the feature it landed on, a key wall or a labelled non-wall or nothing — and scores the rules in missing / extra / net against the key's own walls. `MESSY_MODEL` points it at a trained classifier instead of the rules, for comparison only. Skips without `MESSY_DIR` and asserts the folder holds M*.pdf, so a mistyped path fails rather than reporting a clean nothing",
    "zzLayers.eval.ts":
      "calls no model: reads a handful of pages from each PDF under `REAL_PLAN_DIR` and counts how many strokes carry a CAD layer, what the names are, and what `layerVerdict` makes of them. It exists because a layer test was proposed as the discriminator that would make a scored pairing safe, and the honest answer had to be measured rather than assumed — on the bench it removes nothing, and on real sets it is present on one of five. Skips without `REAL_PLAN_DIR` and asserts the folder holds PDFs, so a mistyped path fails rather than reporting a clean nothing",
    "zzHeldout.eval.ts":
      "calls no model: runs the product's own pipeline over ONE pdf named by `HELDOUT_PDF` and prints what it found — stroke counts, the views it captions, what each filter removed, every run's geometry in feet, and a thickness breakdown. It exists for held-out plans, whose drawing and answer key both live outside the repository: it reads the DRAWING and has no way to reach a key, which `truthWall.test.ts` now enforces for held-out plans the same way it does for the twenty fixtures' committed truth. The scoring against a key is done outside the engine, by a scorer that has read it — that separation is the whole value of the exercise, since a detector that can see the answer is not being measured. Skips without `HELDOUT_PDF` and asserts the file has bytes, so a mistyped path fails rather than reporting an empty sheet",
    "zzSheetVerdict.eval.ts":
      "calls no model: runs the product's own `takeoffSheetVerdict` over every sheet of a REAL set, reading each title block with the keyless glyph reader in `plan-ingest/sheetNumber.ts` and the drawings' own captions with `sheetViews`, and prints what each sheet would be offered. It exists because A130 (PARTITION TYPES) and A140 (PLAN DETAILS) offered wall detection exactly as a floor plan does, and a wall type drawn in section is the most convincing phantom this product can make. It asserts that the reading HAPPENED and prints the whole list rather than a count, because whether each verdict is right is a person's judgement. Reads in place from REAL_PLAN_DIR, writes nothing, prints sheet numbers, titles and verdicts only. Skips without that folder and asserts the named set matched, so a mistyped REAL_PLAN_SET fails rather than printing an empty list",
    "zzMixedSheet.eval.ts":
      "calls no model: a diagnostic for the MIXED-SHEET work — one plan, eight interior elevations and an accessories schedule on one page, all of which were measured as wall. It prints what `sheetViews` names, what `viewRegions` cuts, which views survive the intersection, every scale caption on the page, and then the product's own split beside the whole-sheet result, with each surviving run's angle and how much of its own length actually has a stroke along it. Three separate mechanisms were found with it and two plausible guesses were killed by it — the hatch is NOT caught by counting lines between a pair's faces, which the real walls have more of. Reads a client's drawings in place from REAL_PLAN_DIR, writes nothing, prints counts, feet, angles and view captions only. Skips without that folder and asserts the named PDF was found, so a mistyped REAL_PLAN_SHEET fails rather than printing an empty report",
    "zzPhantom.eval.ts":
      "calls no model: a TEMPORARY diagnostic for the phantom work — it runs `findWallsOnSheet` on named sheets of REAL plan sets and reports the wall graph's islands and thickness bands, which is how the isolated-stub discriminator was measured rather than guessed. Reads in place from REAL_PLAN_DIR and writes nothing; prints counts, feet and thicknesses, never drawing content. Guarded by a skip when REAL_PLAN_DIR is unset plus an assertion that at least one sheet matched, so a mistyped selector fails rather than passing on nothing",
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
        // Any floor, not the literal zero: `zzHeldout.eval.ts` requires its pdf to be
        // over a thousand bytes, which keeps this promise more tightly than `> 0` and
        // was failing a census that insisted on the weaker spelling.
        /expect\([^)]*\.length[\s\S]{0,200}?toBeGreaterThan\(\d+\)/.test(source),
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
