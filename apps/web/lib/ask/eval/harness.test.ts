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
    "zzViewLeak.eval.ts":
      "calls no model: attributes every offered candidate and every key wall on a multi-view sheet to the view whose box holds its midpoint, labelled real / junk / unverdicted from the sheet's own label file. Diagnostic for the view split. Skips without REAL_PLAN_DIR, TAKEOFF_LABEL_DIR and LEAK_SHEETS, and asserts a named sheet was found",
    "zzUserAssist.eval.ts":
      "calls no model: plays the user from the labels on every labelled sheet — one click on the longest junk run for 'exclude walls like this', a work-area box from the real key — and reports junk removed and real lost, per training sheet and as a held-out total. Skips without REAL_PLAN_DIR and TAKEOFF_LABEL_DIR and asserts sheets were read",
    "zzRealisticUser.eval.ts":
      "calls no model: scores the offered list after a simulated user's work-area box and up to three exclude-like clicks with undo, new-build against renovation, held-out as totals. Skips without REAL_PLAN_DIR and TAKEOFF_LABEL_DIR and asserts sheets were read",
    "zzExisting.eval.ts":
      "calls no model: tallies the runs the `existing` set-aside takes on every labelled sheet, by route (tag / area / legend), against the labels as real / junk / unverdicted; training per sheet, held-out as one unnamed total. Skips without REAL_PLAN_DIR and TAKEOFF_LABEL_DIR and asserts sheets were read",
    "zzLegendBox.eval.ts":
      "calls no model: tallies every offered candidate on the training sheets by whether it is the side of a text-filled, cornered box, against the labels; the probe behind legendBoxes.ts. Skips without REAL_PLAN_DIR and TAKEOFF_LABEL_DIR and asserts sheets were read",
    "zzSuggestedScale.eval.ts":
      "calls no model: runs the suggested scale rule over one plan set with each sheet's own scale hidden and writes each source's vote. Skips without its env and asserts pages were named",
    "zzAllSets.eval.ts":
      "calls no model: runs the inventory stage through its dependency seam, wallsPlan and detection over one plan set and writes counts and timings. Skips without ALLSETS_PDF and ALLSETS_OUT and asserts the set had pages",
    "zzRoomsOpen.eval.ts":
      "calls no model: runs the room finder over the offered walls, then adds one thing back at a time, on the training sheets. Skips without its env and asserts sheets were read",
    "zzMissStages.eval.ts":
      "calls no model: attributes each missed foot of key wall to a stage on the product path, with held-out as totals only under MISS_HELD_OUT. Skips without its env and asserts sheets were read",
    "zzAsideRuns.eval.ts":
      "calls no model: lists every run a named set-aside rule removed on the training sheets, with its key coverage. Skips without its env and asserts sheets were read",
    "zzDemotePost.eval.ts":
      "calls no model: scores what the estimate would carry with doubted runs held back, per cut, with held-out as totals. Skips without its env and asserts sheets were read",
    "zzRoomsStill.eval.ts":
      "calls no model: for each named room still open on the training sheets, reports the wall extension that closes it and what is drawn along that gap. Skips without its env and asserts rooms were found",
    "scaleAudit.eval.ts":
      "calls no model: deterministic geometry over real drawings, guarded by a skip plus a non-zero input assertion",
    "doorWindows.eval.ts":
      "calls no model: reads door-swing and window symbols off REAL training floor plans under REAL_PLAN_DIR and scores them against a hand-built key under DW_KEY_DIR (found / missed / false, width error against the schedule's size column, itself a CACHED read); guarded by a skip on every variable",
    "wallTypes.eval.ts":
      "calls no model: the finder over REAL training floor plans under REAL_PLAN_DIR with a stored legend read as the vocabulary (WT_SHEETS), reporting feet typed by tag, carried, note and untyped, feet per type, and ten random runs for crops; guarded by a skip plus a non-zero walls assertion",
    "symbolRaster.eval.ts":
      "calls no model: rasterises a REAL training sheet under REAL_PLAN_DIR as the scan stage would and counts a boxed symbol on the contour lines against the vector key (SR_SET / SR_PAGE / SR_BOX / SR_KEY); guarded by a skip plus a non-zero line assertion",
    "symbolSet.eval.ts":
      "calls no model: lays one boxed symbol over every sheet in scope of a REAL training set under REAL_PLAN_DIR (SS_SET / SS_PAGE / SS_BOX), timing each sheet; guarded by a skip plus a non-zero stroke assertion on the template page",
    "existingMarks.eval.ts":
      "calls no model: reads a REAL training sheet's legend rows, (E)-style tokens and NIC labels off its own text and strokes under REAL_PLAN_DIR / EXISTING_SHEETS, guarded by a skip plus a non-zero text-or-strokes assertion per sheet",
    "symbolCount.eval.ts":
      "calls no model: lays one boxed symbol's strokes over a REAL training sheet under REAL_PLAN_DIR and scores the matches against a hand key under SC_KEY (found / missed / false, time per search); guarded by a skip on every variable plus a non-zero stroke assertion",
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
    "zzViewSweep.eval.ts":
      "calls no model: walks every labelled sheet and prints what the view path keeps against the whole-sheet measure, so a sheet losing its drawing is a listed row rather than an anecdote. Guarded by a skip on the plans and labels folders plus an assertion that at least one labelled sheet was read — with neither folder present it would otherwise print an empty table and read as nothing being lost.",
    "zzOnePipeline.eval.ts":
      "calls no model: measures the SAME five real sheets twice — once the way the server used to (findWallsOnSheet over the whole sheet) and once the way every path runs now (detectForSheet) — so the claim that the two pipelines were different is a printed number rather than a description. Guarded by a skip on REAL_PLAN_DIR and on each file existing, plus an assertion that the page carries >200 strokes: a mistyped page or a scanned sheet would otherwise print 0 and 0 in both columns and read as the paths agreeing.",
    "tagTyping.eval.ts":
      "calls no model: runs `findWallsOnSheet` over the TRAINING floor plans under REAL_PLAN_DIR with the set's CACHED legend read (LEGEND_CACHE) as the library, four vocabularies at once — none, the library's codes, the legend's, both — and tallies tagged footage per verdict. Held-out sets excluded by name, including the plan-text ones. Guarded by a skip on both inputs; writes outside the tree.",
    "realSheets.eval.ts":
      "calls no model: walks a FOLDER of real plan sets named by REAL_PLAN_DIR, picks the floor plans from what each sheet's own title block says, and runs the product's wall pipeline on them. The drawings are a client's confidential documents and stay outside the repository — this file reads them in place, writes its report to REAL_PLAN_OUT, copies nothing and derives no fixture. Guarded by a skip when REAL_PLAN_DIR is unset plus a non-zero PDF-count assertion, because a mistyped folder would otherwise report a clean nothing",
    "wholeSet.eval.ts":
      "calls no model: the whole-set takeoff planner's rule (`plan-ingest/walls.ts`) over every page of ONE real set named by WHOLE_SET_EVAL_SET, taking each sheet's scale from what it PRINTS (`scaleFromPrinted`, never set by hand) and timing the same deterministic `detectForSheet` the stage runs, so the number of sheets a press would do and the seconds it would take are known before a customer presses it. Reads in place from REAL_PLAN_DIR, writes a table to WHOLE_SET_EVAL_OUT, refuses the held-out sets by name, and asserts one row per page so an empty read cannot pass as a clean set",
    "detectProfile.eval.ts":
      "calls no model: times `findWallsOnSheet` — deterministic geometry — on named sheets of REAL plan sets and reports where the seconds go, per stage. It exists because AUDIT.md recorded detection at 102 seconds and said to PROFILE it first rather than guess, and the guess everybody had was wrong: the quadratic pair test took 479ms and the curve assembly took 96% of the run. The drawings are a client's and stay outside the repository, read in place from REAL_PLAN_DIR. Guarded by a skip when REAL_PLAN_DIR is unset, plus an assertion that at least one sheet was actually profiled — a mistyped DETECT_PROFILE_SHEETS would otherwise print nothing and pass, which is a profile of nothing",
    "zzClasses.eval.ts":
      "calls no model: classifies the long lines the pairer could NOT pair on named REAL sheets — by pen weight against the sheet's own wall pen, by company (a hatch is many parallels), by composition (a dashed line is many collinear strokes), by position (past the walls' own box) and by closure — and writes one overlay per class. It changes no detection; it exists so an answer-key reviewer meets a handful of named groups rather than eight thousand feet of line, and it is what established that 93% of A102's unpaired footage is hatching. Reads in place from REAL_PLAN_DIR, writes overlays to REAL_PLAN_OUT, prints counts and pen widths only. Skips without the folder and asserts a sheet matched",
    "zzMissed.eval.ts":
      "calls no model: a TEMPORARY diagnostic for the missed-wall work — it walks the filter chain stage by stage on named REAL sheets and reports what each stage removed, then asks separately how many unclaimed long faces have a valid partner anywhere at all. The first version of it asked a worse question and answered it with an artefact (every heavy line is drawn as two coincident strokes, so its NEAREST parallel is always its own edge), which is recorded in its header. Reads in place from REAL_PLAN_DIR, writes nothing, prints feet and thicknesses only. Skips without that folder and asserts a sheet matched, so a mistyped selector fails rather than passing on nothing",
    "zzNewSetsInk.eval.ts":
      "calls no model: reads the eight sheets behind the new labelling links with the app's own stroke reader and asserts each carries real geometry (floor 2,000 strokes; the thinnest measured is 11,485 and the thickest 120,764). `sheets-for-set.mjs` proves a SCALE could be read from the drawing, which is a different claim — a page can print a scale in its title block and carry a raster, or be a sheet of general notes. It also asserts the split both ways: every sheet marked HELD OUT is refused by `heldOutSets` and every TRAINING one is allowed, so a link cannot be handed out as a test key while a training run eats its labels. Reads held-out PDFs deliberately and safely, since it never looks at a label, a verdict or a key. Skips without REAL_PLAN_DIR",
    "zzWhyUnmatched.eval.ts":
      "calls no model: a DIAGNOSTIC, not a gate. Replays one label file through `restoreSaved` against the candidate list the app would show, in Node, and prints every saved decision that matched nothing beside the nearest candidate to it. It exists because the smoke's split scenario reports \"N saved decisions kept but not shown\" and I guessed at the cause three times — a duplicate split record, a missing one, a half being halved — each plausible, none measured. It also settled who broke it: replaying against the last-green commit gave byte-identical numbers (83 candidates, 0 splits re-applied, 4 unmatched), so the redness is not from that session's changes. Takes WHY_SET and WHY_SHEET; skips without REAL_PLAN_DIR, TAKEOFF_LABEL_DIR and WHY_SET, and asserts the file read as non-empty",
    "zzTriage.eval.ts":
      "calls no model: measures what the viewer's triage withholds, on TRAINING sheets only — real wall feet (a set-aside line lying along an accepted or traced wall in the key) against junk feet, per sheet and per reason. It answers whether the triage is worth keeping as it is, and the answer is not uniform: five of the six reasons withheld 27,934 ft across 165 lines without a single foot of real wall, while `in-a-hatch` accounts for ALL 16,973 ft of real footage. The real figure is a FLOOR and the file says so: a set-aside wall the reviewer never saw, and so never traced, counts as junk here. `heldOutReason` refuses the test buildings. Skips without REAL_PLAN_DIR and TAKEOFF_LABEL_DIR and asserts a sheet was read",
    "zzAppVsEval.eval.ts":
      "calls no model: compares the candidate list the APP showed — recorded in each label file's counts — against the one this folder's evals build, on TRAINING sheets only. It exists because the miss analysis concluded that 1,826 ft of traced wall sat on candidates 'nobody judged', while Chrome's panel had read 109 of 109 and 32 of 32: if every candidate was reviewed, those rows were never in the list. It found gaps up to 128 candidates (Murray A101: app 32, eval 160) and then eliminated every finder INPUT as the cause — identical textItems, identical feetPerUnit from the live calibration, wallTypes empty on both because the table has no rows, sampledSheets removing nothing, and sheetStrokes versus doc.pageStrokes returning identical segment counts — which located the difference AFTER the finder, in the viewer's set-aside triage. Skips without REAL_PLAN_DIR and TAKEOFF_LABEL_DIR and asserts a sheet was read",
    "zzRoomAreaInventory.eval.ts":
      "calls no model: scans every page of every training set under REAL_PLAN_DIR for printed room areas and finish-schedule titles, held-out sets excluded by name and never opened, so the rooms lane knows which sheets can be answer keys without labelling. Guarded by a skip when REAL_PLAN_DIR is unset plus a non-zero set-count assertion",
    "zzRoomKeys.eval.ts":
      "calls no model: writes the room answer keys — printed tags read by position off training pages, BIM spaces joined to their tag text, synthetic truth joined to the tag on the sheet — to a folder beside the confidential plans, outside git. Each source is guarded by its own skip and a non-zero room-count assertion",
    "sheetNumbers.eval.ts":
      "calls no model: reads every page of a REAL scanned set three ways — the tiled strips, the number cell on its own, and the cell snapped to the set's own vocabulary — and counts each against a by-eye key kept outside the repo.",
    "rasterStage.eval.ts":
      "calls no model: runs the RASTER ingest stage's own per-sheet step (render, lines, Tesseract, scale) over the first N pages of one TRAINING set as if every page were a scan, recording time and resident memory per page for the server-budget report. Guarded by a skip when REAL_PLAN_DIR or RASTER_EVAL_SET is unset plus a non-zero page-count assertion",
    "scanned.eval.ts":
      "calls no model: rasterises TRAINING sheets (held-out names refused) at several dpi, clean and scan-like, reads lines and the printed scale off the bitmap (Apple's frameworks or pdf.js + tesseract.js), hands them to the same detectForSheet as the vector path and scores every arm against the keys. Guarded by a skip when REAL_PLAN_DIR or TAKEOFF_LABEL_DIR is unset plus a non-zero label-count assertion",
    "zzRoomDetect.eval.ts":
      "calls no model: runs roomsFromWalls over the label files' accepted walls, the finder's raw pairings, and the BIM keys' own centrelines, and scores area per room against the keys. Guarded by skips on each directory plus a non-zero joined-room assertion, so an empty labels folder cannot read as a clean run",
    "zzRoomLeaks.eval.ts":
      "calls no model: for every leaking room tag in the BOUNDARY dumps, the single wall extension that closes it, written as missed-wall hints for the finder lane. Guarded by a skip on ROOM_DETECT_OUT plus a non-zero sheet-count assertion",
    "zzMissKinds.eval.ts":
      "calls no model: asks WHY the finder missed each wall a reviewer had to trace, on TRAINING sheets only, attributed through the finder's own passes — `onCandidate` is told about every pairing including the ones the greedy pass discards, and the returned stages say which one lost it. It established that over half the traced footage (2,122 of 3,887 ft) lies on a wall the finder DID propose and the reviewer traced instead of accepting, which is robust to a band swept from 0.4 to 2.5 ft, and that only 56 ft is double-counted in the keys. Its own kind classification FAILED twice and says so in the file: 96.8% in one bucket from a points-versus-page-width units bug, then 98.3% in another because a 2.5 ft band catches dozens of strokes — so crops are grouped by stage instead. `heldOutReason` refuses the test buildings. Skips without REAL_PLAN_DIR and TAKEOFF_LABEL_DIR and asserts a sheet with traces was read, because a run over none would print a clean zero",
    "zzRestoreCheck.eval.ts":
      "calls no model: reopens EVERY labelled sheet against the current finder and prints decisions restored, unmatched, traces and splits re-applied, per sheet. It exists because a split heuristic inferred a cut on MHK A1.01 — a sheet never split — and the symptoms all looked like a finder change: 38 of 39 reviewed, accepted footage 524 -> 509 ft, and the duplicate box from five pairs to one, since `splitCandidate` drops pairs naming the candidate it replaces. Its acceptance test is that MHK shows ZERO splits while the sheets that really were split get their decisions back. Reads held-out sheets too, deliberately: this measures what REOPENING does and trains nothing, and a reviewer has to be able to reopen those as well. Skips without REAL_PLAN_DIR and TAKEOFF_LABEL_DIR and asserts at least one sheet was read, because a run over none would print a clean nothing",
    "zzViewDetection.eval.ts":
      "calls no model: runs `detectForSheet` (titles found by lettering and rule, text blocks kept out, every floor kept) against the viewer's old inline pipeline on every TRAINING label file, scored with `scoreSheet` against each sheet's accepted + traced key, leave-one-building-out over the title size ratio — junk removed against real wall lost. Reads the real sets in place from REAL_PLAN_DIR and the label files from TAKEOFF_LABEL_DIR, writes crops of each detected view to VIEW_SHOTS outside the tree, nothing into the repository. Skips without the folders and asserts a non-zero sheet count, so a mistyped path cannot read as a clean zero",
    "zzLoboVeto.eval.ts":
      "calls no model: scores every TRAINING sheet through the product path with and without the trained classifier's veto, leave-one-building-out — in one mode it writes the training rows (LOBO_ROWS_OUT), in the other it reads one fold model per building from LOBO_MODEL_DIR (a building with no rows is scored with the all-rows model) and prints missing and extra feet per sheet, rules against veto. It is what established that the veto removes 2,149 of the 14,316 ft the round-bubble test adds, and later that round-bubbles clears the board's 3-to-1 rule at 3.4. `heldOutReason` refuses the test buildings. Skips without REAL_PLAN_DIR and TAKEOFF_LABEL_DIR and without either output mode, and asserts a non-zero sheet count, so a run over nothing cannot read as a clean zero",
    "zzFinderArms.eval.ts":
      "calls no model: runs the finder four ways on every TRAINING label file — as the PDF stores its strokes, with an answer-key hook set, reversed, and shuffled by a fixed seed — and scores each arm with `scoreSheet` against the sheet's accepted + traced key, so a hook that changes the walls or an order that does is a number rather than a suspicion. Reads the real sets in place from REAL_PLAN_DIR and the labels from TAKEOFF_LABEL_DIR, writes one JSON of the four arms to FINDER_ARMS_OUT outside the tree. Skips without the folders and asserts a non-zero sheet count; FINDER_ARMS_MUST_AGREE=1 makes any disagreement a failure",
    "zzAppEquals.eval.ts":
      "calls no model: runs `detectForSheet` + `offeredCandidates` in Node on the sheets `e2e/specs/takeoff-app-equals-eval.spec.ts` drove in a real browser, at the scale the app STORED and with the answer-key hook the app passes, and holds the two candidate counts side by side — the proof that the viewer and the evals are one pipeline, which found that the finder's answer depends on whether a hook is set. Reads the real sets in place from REAL_PLAN_DIR and the browser's recording from APP_EQ_OUT, writes nothing. Skips without both, asserts the recording is non-empty and that every sheet MATCHES, so a run that read nothing cannot pass",
    "zzViewCaptions.eval.ts":
      "calls no model: measures what VIEW DETECTION is missing on TRAINING sheets only, before anything is written to replace it. It established that `sheetViews` is SCALE-limited rather than vocabulary-limited — 274 caption-like strings against 31 printed scales, and 32 views found, because most sheets print one scale in the title block — and then measured the two geometric signals that could replace the scale: a rule under the title (182, but untrustworthy alone, since a sheet with 65,512 horizontal strokes matches one under almost any text) and text drawn at 1.4x the sheet's median height (53, of which 48 are also underlined). `heldOutReason` refuses the test buildings. Skips without REAL_PLAN_DIR and TAKEOFF_LABEL_DIR and asserts at least one sheet was read, because every count would otherwise be a clean zero",
    "zzFootprint.eval.ts":
      "calls no model: measures a plan-footprint filter on TRAINING sheets only — junk removed against real walls lost, per building, because junk removed on its own hides a building where the filter is wrong. It is what established that the filter DOES NOT work: keeping the primary view removes nothing (sheetViews reports one view on sixteen of eighteen sheets), and the densest paired-wall blob is DISJOINT from where the real walls are on five of them, because the densest region of paired lines is often a different drawing. `heldOutReason` refuses the test buildings. Skips without REAL_PLAN_DIR and TAKEOFF_LABEL_DIR and asserts at least one sheet was read, because a run over no sheets would print a perfect trade",
    "zzJunkKinds.eval.ts":
      "calls no model: `zzRejectKinds` on the PRODUCT path — `detectForSheet` then `offeredCandidates` with the sheet's words, the sweep's own instruments — counting only CONFIRMED junk: the feet of an offered candidate on a `not-wall` verdict and on no real wall, with unlabelled extra on its own line. Breaks it into kinds (stacked dimension strings, a second candidate along a real wall, fixtures, grid lines, unit-plan repeats, kennel grids…) and writes every candidate's features — dashed faces, tees, dimension text between the faces — so a rule can be priced as junk removed per real foot lost BEFORE it is written; the dashed-faces rule was priced this way. TRAINING sheets only through `heldOutReason`. Skips without REAL_PLAN_DIR and TAKEOFF_LABEL_DIR and asserts at least one label file was found, because every number in it would otherwise be a clean zero over nothing",
    "zzDemote.eval.ts":
      "calls no model API: scores the trained wall classifier in GREY-OUT mode, the way the app applies it (`demotedRuns.modelVerdicts` at the 0.2 cut on the product path), per building: of the runs greyed out, the share that the labels call junk, the share of all junk that is greyed, and the real wall greyed in feet — the numbers an estimator feels, which `zzLoboVeto`'s veto totals are not. Leave-one-building-out from a directory of fold models, or one fixed model file; a model whose columns are a prefix of this build's FEATURE_NAMES is scored on that prefix so an older model can be compared. TRAINING sheets only through `heldOutReason`. Skips without REAL_PLAN_DIR, TAKEOFF_LABEL_DIR and a model, and asserts runs were scored, because a clean table over nothing is the vacuous green this directory exists to end",
    "zzRejectKinds.eval.ts":
      "calls no model: breaks the finder's EXTRA footage into kinds on TRAINING sheets only, in feet, so the next rule written is the one with the most feet behind it. `heldOutReason` refuses the test buildings here for the same reason the row builder does — reading what the finder gets wrong on a held-out sheet and then writing a rule for it is tuning on the test key. Every kind is a heuristic over text, geometry and the key, not ground truth, and the file says so: the labels record wall or not-wall and nothing else, so the totals are a RANKING and 'other' staying large is the honest outcome. Skips without REAL_PLAN_DIR and TAKEOFF_LABEL_DIR and asserts at least one sheet was read, because every number in it would otherwise be a clean zero over nothing",
    "zzExtract.eval.ts":
      "calls no model: re-draws every bench sheet, runs the finder with the `onCandidate` hook, and writes one training row per candidate pairing to `EXTRACT_OUT` — the feature vector plus a label taken from the bench's own key by geometry, so no grader is reimplemented and no judgement is involved. It includes the ZERO-WALL sheets, where every candidate is a negative and where the errors this is aimed at live. Skips without `EXTRACT_OUT`, and asserts both that candidates were extracted at all and that some matched a key wall, because a run labelling nothing positive would train a model that says no to everything and score well on an unbalanced set",
    "zzOffsetWhy.eval.ts":
      "calls no model: asks whether the offset check's flags are its own fault, by looking up the CAD layer of every line in the face pair it chose — `layerNames.ts` already reads `S-GRID` and its relatives. Prints each sheet's layer coverage FIRST and reports a sheet with no layers as UNTESTABLE rather than as clean, which is what the ELEVEN03 exports turned out to be: 0% of 57,510 segments carry one, so the grid question cannot be asked of them at all. Skips without `REAL_PLAN_DIR` and `TAKEOFF_LABEL_DIR`; asserts at least one sheet was read",
    "zzPartitionText.eval.ts":
      "calls no model: prints the text of named pages grouped into lines, filtered to the ones mentioning an assembly word, so a partition legend can be READ before anything parses one. Written because `wallTags.ts` records a set with no partition schedule at all, so the shape of the text is not safe to assume. Skips without `REAL_PLAN_DIR` and `PT_SHEETS`; asserts at least one page was read",
    "zzWallTypeChain.eval.ts":
      "calls no model: walks one wall type from the tag beside a wall on Camp Bow Wow A101, through the partition legend's own words on A130, to proposed components and the quantities they produce. Takes the legend's lines directly because `SCHEDULE_ROWS` never runs on that sheet — it is a legend rather than a table, which `planSheets`' prompt types as OTHER. Skips without `REAL_PLAN_DIR`; asserts walls were found, components were produced, and that a run carrying a tag produced quantity lines",
    "zzDoorMarks.eval.ts":
      "calls no model: counts the mark-shaped text on named pages so the plan's side of a door-schedule join can be compared with the schedule's before anything is built to join them. Written because the same question asked of WALL-TYPE tags answered badly — Camp Bow Wow's partition marks are bare letters and `wallTypeTags` reads zero on A101. Skips without `REAL_PLAN_DIR` and `DM_SHEETS`; asserts a page was read",
    "zzOpeningJoin.eval.ts":
      "calls no model: measures how many of a plan's drawn openings a door schedule can name, with the match rate, the rows placed, and any gap that disagrees with its scheduled door. Reads the schedule page's marks with a crude text pass rather than `scheduleRows.ts`, because that stage is a model call that has never run on this machine — so the rate it reports is a floor rather than a forecast, and the eval says so. Skips without `REAL_PLAN_DIR`; asserts openings were found, marks were found, and rows were read, because a run missing any of the three reports 0% and looks like a measurement of the join",
    "zzTagSymbols.eval.ts":
      "calls no model: prints every small closed symbol on the named pages with its shape, its contents and why it was rejected, so the tag detector can be judged against a sheet somebody can open. Skips without `REAL_PLAN_DIR` and `TS_SHEETS`; asserts a page was read AND that some symbol was found anywhere, because a run that found none says the detector did not run rather than that the sheets are bare",
    "zzLegendRead.eval.ts":
      "CALLS A MODEL, once per set and cached on disk by file, page and prompt version, so re-running is free and changing the prompt costs one call; `LEGEND_LIVE=0` refuses the call and reads only the cache. Finds the partition legend with `legendPages`, reads it with `extractWallLegend`, and turns each type's verbatim lines into proposed components. Skips without `REAL_PLAN_DIR` and `LEGEND_SET`; asserts a candidate page was found and that the read returned types. A legend that describes its types in WORDS but yields no component fails the run; one that names only UL design numbers — as ELEVEN03's does — is reported and passes, because the assembly is in the UL directory rather than on the drawing",
    "zzChain2.eval.ts":
      "calls no model, reading the legend from `zzLegendRead.eval.ts`'s cache: walks one wall type from the SYMBOL its tag is drawn in, through the legend's words, to proposed components and the quantities they produce for the runs that carry that tag. Replaces the text-matched chain, which read zero tags on Camp Bow Wow because its partition marks are bare letters. Skips without `REAL_PLAN_DIR` and `LEGEND_CACHE`; asserts the cache exists, the legend defines codes, and that a tagged type produced components",
    "zzDoorJoin2.eval.ts":
      "CALLS A MODEL for the door schedule, cached per file and page: reads the table with the real `extractScheduleRows` rather than a text pass, finds door marks by the symbols they are drawn in, and reports the match rate both ways so the symbol filter can be judged against plain text rather than assumed better. Skips without `REAL_PLAN_DIR` and `DOOR_CACHE`; asserts rows were read, openings were found and symbols were found",
    "zzDrainIngest.eval.ts":
      "calls no model: an operator's tool, not a test. Runs the ingest queue to completion with the same `runIngest` and ports the HTTP route builds, because that route is a GET behind `CRON_SECRET`, this machine has no such secret, and the route fails closed without one — correctly. Only runs when `DRAIN_INGEST=1`, so a full suite never touches the queue; refuses a non-local `DATABASE_URL`; picks a job with a PENDING TASK rather than an unfinished one, which is the question that was meant and the reason a first run stopped after one set of twelve",
    "zzSheetsReady.eval.ts":
      "calls no model: for each sheet named in `READY_LIST`, checks the three things a labeller needs — a calibration exists in the database, it converts to a usable feet-per-page-width, and the finder returns runs when given it. Takes the scale FROM THE DATABASE rather than a constant, because that is what the app will use. Skips without `REAL_PLAN_DIR` and `READY_LIST`; refuses a non-local database; asserts the list named sheets, that at least one was ready, and that EVERY one was — a partial pass is a sheet somebody would be sent to label and could not",
    "setUsability.eval.ts":
      "calls no model: answers the first two items of NEW-SETS.md's checklist per page and per set — is the PDF vector (path operators and a text layer, rather than one photograph a page), and does it print a scale a machine can read, either a title-block scale `scaleFromPrinted` accepts or dimension strings the dimension reader could vote on. Written by the session that surveyed the twelve new sets, and merged here; its entry was missing, which is why this census refused the merge until it was written. Skips without `REAL_PLAN_DIR`; asserts the folder held at least one PDF, so a run against an empty or wrong directory fails rather than reporting a clean nothing",
    "zzTrainRows.eval.ts":
      "calls no model: turns every labelled sheet into training rows, the step that used to live in a scratch script outside the repository — which is why `trainingRowsCensus` found nothing to guard for weeks. Rebuilds rows from the saved VERDICTS against the candidates this finder produces now, matched by geometry, because a label file's stored rows belong position-by-position to the finder that wrote them; features come from the finder's own `onCandidate` hook rather than being recomputed, since two implementations of a feature vector is how a model gets trained on numbers the app never produces. Refuses the four held-out buildings through `trainingRows` and names them. Prints the POSITIVES PER BUILDING before anything is trained — six labelled sheets once turned out to be three buildings with 89% of the positives in one, and the model transferred to nothing. Writes a `.columns` file from FEATURE_NAMES so the trainer's columns cannot drift from the product's features. Asserts every sheet is accounted for as scored, refused or skipped",
    "zzWhyNone.eval.ts":
      "calls no model and writes nothing: walks the finder's stages for ONE sheet and reports what survived each — strokes, drawing regions, views and their captions, pairings, runs — so the stage that empties the list names itself. \"Nothing to review on this sheet\" is one message for several very different failures, and guessing between them is how a guard gets relaxed for a sheet that never needed it. On Murray A101 it showed 103,984 strokes and 158 runs at the calibrated scale, which placed the fault in view selection rather than in the geometry: both captions print no scale, and `wallsPerView` dropped every band. Needs WHYNONE_JOB, WHYNONE_PAGE and WHYNONE_FPU; asserts the page has strokes and that regions or views were computed, so a page number matching nothing cannot read as a clean empty sheet",
    "zzPayload.eval.ts":
      "calls no model and writes nothing: rebuilds one sheet with the finder and measures the BODY a reviewer's save would send. Written because Bunkie A100 failed with \"the request body was not JSON\" while two sheets had saved minutes earlier — the body was 11.27 MB, the route handler's middleware truncates at 10 MB, and `request.json()` threw on half a document. The gap it exposes is between 56 runs on screen and 39,952 PAIRINGS in the payload: a reviewer judges runs, a model decides about pairings, and every pairing travels with its 24-number feature vector. Also counts non-finite features, which was a suspect and was eliminated at zero. Needs PAYLOAD_JOB, PAYLOAD_PAGE and the sheet's real PAYLOAD_FPU — with a scale of 1 the finder reports nothing and the measurement is about a sheet nobody is looking at",
    "zzAudit.eval.ts":
      "calls no model and WRITES NOTHING: audits the saved label files and nothing else — no PDF, no database, no finder — which is what makes it runnable while somebody is labelling the next sheet. Flags accepted runs that overlap each other (the estimate bills the same feet twice, and both runs look right on their own), traces lying over an accepted run (double-counted KEY footage, which inflates a held-out score in the flattering direction), undecided candidates (they become confident NEGATIVES in training if the sheet is marked complete), not-sure runs with their footage, accepted feet against the sheet's own width (a scale out by ten does not look wrong on screen — every wall is still a wall — and only the total gives it away), and a finderVersion that is dirty, missing, or different from the build now running. Also prints the rules-only accepted and EXTRA footage per training sheet, and says in as many words that MISSING footage is not measurable there, because a training sheet has no traces and a finder proposing nothing would show zero extra and look perfect. Asserts that label files matched and that every one was audited or reported unreadable",
    "zzKeyScore.eval.ts":
      "calls no model and writes nothing: scores the finder against the four held-out buildings' answer keys, where the key is ACCEPTED plus TRACED walls — the traced half being what makes it a test rather than a mirror, since a key of accepted runs alone contains only walls the finder already proposed and a finder proposing nothing would score perfectly. Reports missing / extra / net linear feet per sheet and in total, summed rather than averaged, because a sheet 50 ft over and one 50 ft under is a bid that is right by accident. Prints NO HELD-OUT LABELS YET in as many words when none exists, rather than a clean total over zero sheets; asserts label files were found and that every held-out file found was either scored or explicitly noted as skipped",
    "zzDupAgree.eval.ts":
      "calls no model and writes nothing: scores the duplicate keeper against nine sheets of HUMAN verdicts, asking of each pair the rule decides whether a reviewer accepted the twin it kept. Every earlier measurement counted how many pre-marks CHANGED, which is disturbance rather than correctness — four swaps is equally consistent with four fixes and four new mistakes. Scored only on pairs the reviewer SPLIT, since a pair they rejected entirely says nothing about which reading was better; 97 of 97 on 2026-10-20, and it is what refuted the thickness-matching rule (82 of 96) before it could ship. Skips without `REAL_PLAN_DIR` and `TAKEOFF_LABEL_DIR`; asserts label files were found, so a run over an empty directory cannot report a perfect score about nothing",
    "zzDupResave.eval.ts":
      "calls no model: applies the changed duplicate pre-marks to the SAVED label files, and a dry run until `RESAVE=1`. Only moves a verdict the pre-marking itself wrote — keeper accepted, dropped rejected — because overwriting anything else is undoing a reviewer's decision with a rule; anything else is reported and left alone. Matches saved runs to fresh candidates by GEOMETRY within about three inches rather than by equality, since the finder that wrote the file has changed since. Keeps a `.bak` beside each file it touches, written once and never overwritten",
    "zzDupChange.eval.ts":
      "calls no model and writes nothing: re-runs the duplicate finder over every labelled sheet BOTH ways — keeping the longer twin as it did, and keeping the better-supported twin as it does now — and counts the pairs whose keeper swaps. Asked for before re-saving anything, which is the right order: a rule change that silently rewrote a hundred verdicts would be indistinguishable from one that fixed two. Skips without `REAL_PLAN_DIR` and `TAKEOFF_LABEL_DIR`; asserts label files were found, that a sheet could actually be re-measured, and that some duplicate pair exists — a run finding none compares nothing",
    "zzTagReport.eval.ts":
      "calls no model, reading the legend from `zzLegendRead.eval.ts`'s cache: prints every symbol on a plan that holds a legend code, with its shape, size, divider, leader, position, the distance to the nearest run and the next, and the pairing verdict — so `zzChain2`'s totals can be read symbol by symbol against the sheet. Skips without `REAL_PLAN_DIR` and `LEGEND_CACHE`; asserts the cache exists and that some symbol held a legend code, because a run that found none says the detector did not run",
    "zzLegendFixture.eval.ts":
      "calls no model: builds the stored shape of a PlanLegendProposal for a REAL legend page (Baker's A601) from the two CACHED model reads and the crop rectangles `legendCropRects` places from the page's own text and symbols, for the optional real-drawing run of wall-legend-library.spec.ts. Reads the PDF in place from REAL_PLAN_DIR and the cache from LEGEND_CACHE; writes ONE file, at LEGEND_FIXTURE_OUT, and refuses a path inside the repository because the file holds a client's legend verbatim — the committed fixture is invented",
    "zzLegendSight.eval.ts":
      "CALLS A MODEL, once per set and cached on disk by file, page and prompt version beside the text read's cache; `LEGEND_LIVE=0` refuses the call. Renders the legend page and one crop per wall type through a Swift script named by `LEGEND_RENDER`, because Node here cannot rasterise a PDF, and asks the model for each type's fields from the drawing as well as its words. Prints per type what the text read and the sight read each got and whether each is FULLY read, and writes a contact sheet of every crop beside both readings so a person can check the model against the drawing. Skips without `REAL_PLAN_DIR`, `LEGEND_CACHE`, `LEGEND_SET`, `LEGEND_PAGE`, `LEGEND_RENDER` and `LEGEND_SIGHT_OUT`; asserts the text read is cached and the sight read returned types",
    "zzFeetTyped.eval.ts":
      "calls no model, reading the legend from `zzLegendRead.eval.ts`'s cache and the walls from a LABEL FILE rather than the finder: of the feet a reviewer accepted, how many get a type from a symbol tag, from bare text the legend knows, by propagation along the wall, and by the sheet's U.N.O. note — the number an estimator reads, where `zzTagReport` counts runs. Skips without `LABEL_FILE`, `REAL_PLAN_DIR`, `LEGEND_CACHE` and `CHAIN_SET`; asserts the cache exists and the label file holds accepted walls, because a sheet with none measures nothing",
    "zzDoorReport.eval.ts":
      "calls no model, reading the door schedule from `zzDoorJoin2.eval.ts`'s cache: for every scheduled mark, how many times it is printed on the plan, in which symbols, and how far each printing sits from the nearest detected opening — the per-row view behind the join's match rate, which is what showed that 17 of 30 doorways have no detected gap within 8 ft of their mark. Skips without `REAL_PLAN_DIR` and `DOOR_CACHE`; asserts the cache exists and rows were read",
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
    "zzCeilings.eval.ts":
      "calls no model: reads named TRAINING ceiling plans — room tags, set-wide legend, drawn pattern, finish-schedule rows, keynotes — and scores family, height and area per room against hand-written answer keys. Refuses any held-out set through `heldOutReason`. Guarded by a skip on REAL_PLAN_DIR plus a non-zero page assertion.",
    "zzCeilingPages.eval.ts":
      "calls no model: dumps the text items of named ceiling-plan pages to JSON so the readers can be written from what a page prints. Guarded by a skip on REAL_PLAN_DIR / CEILING_PAGES_OUT plus a non-zero page assertion.",
    "zzCeilingTagText.eval.ts":
      "calls no model: prints the text stacks under each room tag on named ceiling-plan pages, a diagnostic for the tag reader. Guarded by a skip plus a non-zero page assertion.",
    "zzCeilingScheduleProbe.eval.ts":
      "calls no model: runs `tableRowsFromPage` over named finish-schedule pages and prints the rows, to see whether a set's schedule has a ceiling column before a reader is written for it. Guarded by a skip plus a non-zero page assertion.",
    "zzWallHeights.eval.ts":
      "calls no model: reads wall heights off the drawings from the cached legend text read and the label file — the second session's eval, carried here unchanged. Guarded by a skip on four inputs plus non-zero type and page assertions.",
    "zzCeilingInventory.eval.ts":
      "calls no model: scans every page of every TRAINING set under REAL_PLAN_DIR for ceiling-plan titles, ceiling legends, A.F.F. heights and ceiling type tokens, held-out sets excluded by name and never opened unless CEILING_INVENTORY_INCLUDE_HELDOUT=1 says so, so the ceilings lane knows which sets print what before reading any. Guarded by a skip on REAL_PLAN_DIR plus a non-zero set assertion.",
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
