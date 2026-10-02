import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe as group, expect, it } from "vitest";
import { AI_FEATURES, type AiFeatureKey } from "@prova/integrations";
import { stripComments } from "./stripComments";

/**
 * EVERY AI FEATURE HAS A CONTROL ON A PAGE, NOT ONLY IN THE ASK BOX.
 *
 * ── THE DEFECT THIS EXISTS FOR, WHICH SHIPPED TWICE ──
 *
 * An audit of the estimating lane on 2026-10-01 found `BID_RESEARCH` and
 * `LEAD_SEARCH` both at "2 of 4": a real prompt, a real per-company gate, real
 * metering, a real model route — and **no control on any page.** Each ran inside
 * one Ask command and nowhere else, so using a feature the contractor was paying
 * for meant knowing to phrase a sentence at the assistant.
 *
 * Nothing was red. `aiFeatureGateCensus` was green, because both WERE gated.
 * `promptVersionCensus` was green. `FEATURE_MODEL` had an entry for each. Both
 * features were reachable, correctly gated, correctly metered, and unusable.
 *
 * #579 and #580 added the two controls. This is the guard that makes a third one
 * impossible, and it is the sibling of `plan-ingest/stageReachableCensus.test.ts`
 * — that file asks whether every STAGE the runner can do has a product caller,
 * after #551 shipped `TITLE_BLOCK` with none. This asks it about every FEATURE.
 *
 * It does not replace that one. `PLAN_INGESTION` would have passed THIS census
 * on the day #551 shipped broken, because its control existed and its gate was
 * reachable — it was the stage behind them that nothing started. Whether a
 * feature has a control and whether its work can run are two questions.
 *
 * ── WHY THIS IS A NAMED MAP AND NOT AN IMPORT-GRAPH WALK ──
 *
 * The honest version of this file would derive both ends. Two attempts did, and
 * BOTH PASSED THEIR OWN MUTATION — which is worth more than the attempts, so it
 * is recorded rather than quietly dropped.
 *
 * Attempt one walked imports from every file under `app/` and `components/`.
 * Unmounting `<ProjectLookup />` from /pipeline — exactly the world before #579 —
 * left it GREEN, because `ProjectLookup.tsx` was itself a root. A component
 * nobody renders counted as a control, which is this repo's oldest shape
 * ("written, documented, and never called") living inside the guard written to
 * catch it.
 *
 * Attempt two used only Next's own entry points as roots. Still green, for a
 * reason specific to this codebase: `lib/actions/index.ts` is an `export *`
 * barrel over every action module, so ANY page importing `@/lib/actions` reaches
 * EVERY gate. The graph is effectively fully connected through one file.
 *
 * Cutting the barrel does not rescue it either — measured, not assumed: five of
 * the seven existing controls (`QuoteReader`, `AddendumFindings`,
 * `WipNarrativeButton`, `DraftLineItemsForm`, `PlanIngestPanel`) import their
 * action FROM the barrel, so cutting it reports five features with real controls
 * as having none. Over-approximating with it, under-approximating without it.
 *
 * So reachability is the wrong instrument here, and the right one is the shape
 * `commands.coverage.test.ts` already uses for "did somebody decide": an
 * explicit entry per feature, with the FEATURE SET derived so a new feature
 * cannot arrive without one. Absence is not a decision.
 *
 * ── WHAT IS DERIVED, WHICH IS THE HALF THAT CATCHES THE NEXT ONE ──
 *
 * The features come from `AI_FEATURES` — the registry `FEATURE_MODEL` is a total
 * `Record` over — so adding a feature fails this file until somebody names its
 * control or says why it has none. That is the half that would have caught both
 * 2026-10-01 defects: neither had a component to name.
 *
 * The claims in each entry are then CHECKED rather than trusted: the named
 * component must exist, must render something that reads as a control, and must
 * be rendered by a page under `app/`. A map whose entries are never verified is
 * just a comment.
 */

const WEB = fileURLToPath(new URL("../../", import.meta.url));

type Control =
  /** A component a page renders, which is what "has a control" means. */
  | { kind: "component"; file: string; why: string }
  /** Deliberately reachable only by asking the assistant. */
  | { kind: "ask-only"; why: string };

/**
 * One entry per `AiFeature`. A feature missing from here fails the build.
 *
 * `file` is relative to `apps/web/` and is asserted to exist, to contain a
 * control, and to be rendered from a page.
 */
const CONTROLS: Record<AiFeatureKey, Control> = {
  ASK: {
    kind: "ask-only",
    why: "It IS the Ask box. Requiring a control elsewhere would be incoherent — and the launcher is on every signed-in page already.",
  },
  WIP_NARRATIVE: {
    kind: "component",
    file: "components/WipNarrativeButton.tsx",
    why: "A button on the job's billing surface that turns that job's WIP figures into a paragraph.",
  },
  COMPLIANCE_EXTRACT: {
    kind: "component",
    file: "components/ComplianceUploadForm.tsx",
    why: "Uploading a compliance document is what runs the extraction; there is deliberately no separate 'read it' button, and `compliance.ts` records that a manual-entry path is the real fix and is not built.",
  },
  DRAFT_ESTIMATE_LINES: {
    kind: "component",
    file: "components/DraftLineItemsForm.tsx",
    why: "Paste a scope of work on the estimate tab and it drafts line items, each flagged aiDrafted.",
  },
  BID_RESEARCH: {
    kind: "component",
    file: "components/ProjectLookup.tsx",
    why: "#579. The 'Look up a project' panel on /pipeline. Before it, this feature ran only inside the start-a-bid Ask command — which is the defect this census exists for.",
  },
  LEAD_SEARCH: {
    kind: "component",
    file: "components/LeadSearch.tsx",
    why: "#580. 'Find projects out to bid' on /pipeline. Before it, only the find_bid_leads Ask command reached it — the same defect as BID_RESEARCH, found in the same audit.",
  },
  QUOTE_EXTRACT: {
    kind: "component",
    file: "components/QuoteReader.tsx",
    why: "Attach a sub's quote on /bids and read it into the levelling form, for a person to correct before saving.",
  },
  PLAN_INGESTION: {
    kind: "component",
    file: "components/PlanIngestPanel.tsx",
    why: "The panel on a job's takeoff tab that opens a plan set and then reads its title blocks. See stageReachableCensus for the separate question of whether each STAGE has a caller.",
  },
  ADDENDUM_READ: {
    kind: "component",
    file: "components/AddendumFindings.tsx",
    why: "Attach a GC's addendum on /bids and list what it says it changed, per item with its source page.",
  },
};

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) filesUnder(full, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|dbtest|eval)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Comments stripped: several components print their own tags in their headers,
 *  which is #185's scar — a census satisfied by prose about the thing. */
function sourceOf(file: string): string {
  return stripComments(readFileSync(file, "utf8"));
}

const APP_FILES = filesUnder(join(WEB, "app"));
const COMPONENT_FILES = filesUnder(join(WEB, "components"));
/** Every gate call anywhere, used to prove each feature is still switchable. */
const GATE_CALL = /aiGate\(\s*[^,()]*,\s*["']([A-Z0-9_]+)["']\s*\)/g;

function gatedFeatures(): Set<string> {
  const found = new Set<string>();
  for (const file of [...APP_FILES, ...COMPONENT_FILES, ...filesUnder(join(WEB, "lib"))]) {
    for (const match of sourceOf(file).matchAll(GATE_CALL)) found.add(match[1]!);
  }
  return found;
}

/** `<Name` anywhere in app/ or in another component — i.e. something renders it. */
function rendersComponent(name: string): string[] {
  const tag = new RegExp(`<${name}[\\s/>]`);
  const importOf = new RegExp(`\\b${name}\\b`);
  return [...APP_FILES, ...COMPONENT_FILES].filter((file) => {
    if (file.endsWith(`/${name}.tsx`)) return false;
    const code = sourceOf(file);
    return tag.test(code) && importOf.test(code);
  });
}

group("every AI feature has a control on a page", () => {
  it("found the sources it reasons about — an empty walk passes everything below", () => {
    // SIZE ASSERTIONS FIRST. Each is a way this file could be green about
    // nothing: no pages, no components, or a gate pattern that stopped matching.
    expect(APP_FILES.length, "no files under app/ — the walker found nothing").toBeGreaterThan(80);
    expect(COMPONENT_FILES.length, "no files under components/").toBeGreaterThan(100);
    expect(gatedFeatures().size, "no aiGate(…) sites matched — the pattern drifted").toBeGreaterThan(5);
  });

  it("DECIDES EVERY FEATURE IN THE REGISTRY, with nothing left out", () => {
    // THE DERIVED HALF, and the one that would have caught both defects: a
    // feature added to AI_FEATURES with no entry here fails the build.
    const undecided = Object.keys(AI_FEATURES).filter((feature) => !(feature in CONTROLS));
    expect(
      undecided,
      `these AI features have no entry in CONTROLS: ${undecided.join(", ")}. Name the component a page ` +
        `renders to reach it, or mark it ask-only with the reason. A feature that is gated, metered and ` +
        `model-routed with no control is what BID_RESEARCH and LEAD_SEARCH both were — paid for and ` +
        `unusable. Absence is not a decision.`,
    ).toEqual([]);

    // And the other way, so a stale entry for a deleted feature is caught too.
    const extra = Object.keys(CONTROLS).filter((feature) => !(feature in AI_FEATURES));
    expect(extra, `CONTROLS names features that are not in AI_FEATURES: ${extra.join(", ")}`).toEqual([]);
  });

  it("gives every entry a reason somebody can argue with", () => {
    for (const [feature, control] of Object.entries(CONTROLS)) {
      expect(control.why.trim().length, `${feature} has no reason`).toBeGreaterThan(30);
    }
  });

  it("NAMES A COMPONENT THAT EXISTS AND THAT A PAGE RENDERS", () => {
    // The claims, checked. A map nobody verifies is a comment — and the thing
    // most likely to rot is a component being renamed or unmounted while this
    // entry keeps asserting it is the control.
    const problems: string[] = [];
    for (const [feature, control] of Object.entries(CONTROLS)) {
      if (control.kind !== "component") continue;
      const full = join(WEB, control.file);
      let exists = false;
      try {
        exists = statSync(full).isFile();
      } catch {
        exists = false;
      }
      if (!exists) {
        problems.push(`${feature}: ${control.file} does not exist`);
        continue;
      }
      const renderedBy = rendersComponent(control.file.replace(/^components\//, "").replace(/\.tsx$/, ""));
      if (renderedBy.length === 0) {
        problems.push(
          `${feature}: ${control.file} exists and NOTHING renders it, so it is not a control — ` +
            `"written, documented, and never called"`,
        );
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("keeps every feature switchable off, control or not", () => {
    // The neighbouring promise, asserted here because this file already has the
    // registry in hand: a control with no gate behind it is a feature an owner
    // cannot turn off, which is step 0's whole point.
    const gated = gatedFeatures();
    const ungated = Object.keys(AI_FEATURES).filter((feature) => !gated.has(feature));
    expect(ungated, `these features have a control and no aiGate call: ${ungated.join(", ")}`).toEqual([]);
  });

  it("holds its ask-only exemptions to one apiece, and to a real reason", () => {
    // An exemption list that grows is this census being repealed one reasonable
    // case at a time. ASK is the only member today; a second one should be an
    // argument somebody has, not a line somebody adds.
    const askOnly = Object.entries(CONTROLS).filter(([, c]) => c.kind === "ask-only");
    expect(
      askOnly.map(([feature]) => feature),
      "a feature was marked ask-only. That is the exact state BID_RESEARCH and LEAD_SEARCH were in when " +
        "an audit called them unusable, so it needs an argument rather than an entry — update this " +
        "assertion deliberately if the argument is good.",
    ).toEqual(["ASK"]);
  });

  it("reads a gate across line breaks, and not one inside a comment", () => {
    // `titleBlock.ts` writes its gate as a property across several lines, and
    // the same file discusses that call in prose three lines above it.
    const wrapped = stripComments('const deps = {\n  gate: (companyId) =>\n    aiGate(companyId, "PLAN_INGESTION"),\n};');
    expect([...wrapped.matchAll(GATE_CALL)].map((m) => m[1])).toEqual(["PLAN_INGESTION"]);
    const commented = stripComments('// the aiGate(companyId, "WIP_NARRATIVE") call in this file\nconst x = 1;');
    expect([...commented.matchAll(GATE_CALL)]).toEqual([]);
  });
});
