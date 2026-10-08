import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { looksLikeEmail } from "@prova/integrations";

import { appSourceFiles, fileLiterals } from "./source-literals";
import {
  DELIVERABLES,
  DELIVERY,
  DEDUPE_WINDOW_HOURS,
  HOURLY_LEAD_CEILING,
  LIMITS,
  NEXT_STEPS,
  OFFER_TRADES,
  OFFER_TRADE_VALUES,
  confirmation,
  looksLikeEmailAddress,
  offerTradeLabel,
  overCeiling,
  requestNote,
  requestProblem,
  withinDedupeWindow,
  type OfferRequest,
} from "./takeoff-offer";

/**
 * A PUBLIC PAGE PROMISING SOMETHING THE APP CANNOT DO IS NOT A COPY BUG — IT
 * IS A CONTRACTOR WHO SENT US THEIR BID SET FOR NOTHING.
 *
 * `/wall-takeoff` offers a free read of a drawing set to somebody we are
 * trying to sell to. The asymmetry is the whole reason this census exists:
 * they hand over the one file they cannot un-send, and the page is the only
 * thing they had to go on. So every line of the offer names the code that
 * produces it (`Deliverable.backing`) and this file resolves every one of
 * those names against the repository.
 *
 * ── WHY A HUMAN READER IS NOT ENOUGH, MEASURED RATHER THAN ASSERTED ──
 *
 * `components/LandingPage.tsx`'s header records a brief for that page asking
 * for a panel comparing estimated against actual labour HOURS. The app
 * compares DOLLARS. It was caught by one person noticing during the build —
 * no check could have. That is the defect this file is pointed at, one
 * audience and one page over.
 *
 * ── THE TWO THINGS THIS ASSERTS THAT A SMALLER TEST WOULD NOT ──
 *
 * 1. Every `backing` RESOLVES. A stage must be in `stages.ts`'s own
 *    `STAGE_WORK` map with non-null work; a module symbol must be exported by
 *    the file named. So a deliverable for `CLASSIFY` — a stage that exists in
 *    the enum and is deliberately never built — fails here.
 * 2. The offer list is the ONLY one. CLAUDE.md's rule for a canonical list is
 *    both guards, because a completeness test cannot see a consumer that
 *    stopped reading the list: "nothing is ever missing from a list nobody
 *    imports." So this walks every app source and fails on a hand-written
 *    second copy of any promise, and separately asserts the landing component
 *    reads the real one.
 *
 * Both halves carry a SIZE assertion against a source that cannot drift with
 * the pattern that found it, for the reason `scratch-cleanup-order.test.ts`
 * learned the hard way: a parser that matches nothing passes every downstream
 * assertion, because nothing is ever missing from an empty set.
 */

const webDir = fileURLToPath(new URL("..", import.meta.url));
const repoDir = resolve(webDir, "../..");

const OFFER_MODULE = resolve(webDir, "lib/takeoff-offer.ts");
const LANDING_COMPONENT = resolve(webDir, "components/WallTakeoffOffer.tsx");

/** This file and the module itself are the two places the promises are
 *  allowed to appear as literals. */
const ALLOWED_LITERAL_FILES = new Set([OFFER_MODULE, resolve(webDir, "lib/takeoff-offer.test.ts")]);

// ── the stage map, parsed from stages.ts rather than imported ──────────────
//
// Imported, `stages.ts` drags `pdfjs-dist` and the Prisma client in behind it
// for an answer that is five lines of a literal map. Parsed, it needs a size
// assertion — so the count is pinned against the ENUM in the schema, which is
// a different file maintained for a different reason and cannot drift with
// this regex. If either parse returns nothing, the equality below fails
// loudly instead of the set quietly shrinking to empty.

const stagesSource = readFileSync(resolve(webDir, "lib/plan-ingest/stages.ts"), "utf8");

// Lazy up to the `= {`, NOT `[^=]*`. The first version of this line used a
// negated character class to cross the type annotation, and the annotation
// contains `(ctx: StageCtx) => StageWork` — so it stopped dead at the arrow's
// `=` and the whole map parsed to nothing. The size assertion below caught it
// on the first run and named it, which is the entire reason it is there:
// CLAUDE.md's rule is that a check which DERIVES its input has two failure
// modes and only one of them looks like a failure. An empty parse would
// otherwise have made every backing check below pass vacuously.
const stageWorkBlock = stagesSource.match(/const STAGE_WORK:[\s\S]*?=\s*\{([\s\S]*?)\n\};/);

const stageEntries: { stage: string; built: boolean }[] = [...(stageWorkBlock?.[1] ?? "").matchAll(
  /^\s{2}([A-Z_]+):\s*(null|[A-Za-z]\w*)\s*,/gm,
)].map((m) => ({ stage: m[1], built: m[2] !== "null" }));

const schemaSource = readFileSync(
  resolve(repoDir, "packages/db/prisma/schema/plan-ingest.prisma"),
  "utf8",
);
const enumBlock = schemaSource.match(/enum PlanIngestStage \{([\s\S]*?)\n\}/);
const enumMembers = [...(enumBlock?.[1] ?? "").matchAll(/^\s{2}([A-Z_]+)\s*$/gm)].map((m) => m[1]);

const BUILT_STAGES = new Set(stageEntries.filter((e) => e.built).map((e) => e.stage));

// ── the app's own sources, for the second-copy half ────────────────────────

const corpus = [
  resolve(webDir, "app"),
  resolve(webDir, "components"),
  resolve(webDir, "lib"),
].flatMap((dir) => (existsSync(dir) ? appSourceFiles(dir) : []));

describe("takeoff offer — the stage map this census reads", () => {
  it("parsed the same number of stages the schema enum declares", () => {
    // The guard on the guard. Two files, two maintainers, one number.
    expect(enumMembers.length).toBeGreaterThanOrEqual(5);
    expect(stageEntries.map((e) => e.stage).sort()).toEqual([...enumMembers].sort());
  });

  it("found at least one built stage and at least one deliberately unbuilt one", () => {
    // A parse that decided everything was null would make the backing check
    // vacuous in the strict direction; one that decided everything was built
    // would make it vacuous in the permissive direction. Neither is allowed
    // to pass silently.
    expect(BUILT_STAGES.size).toBeGreaterThan(0);
    expect(stageEntries.some((e) => !e.built)).toBe(true);
  });
});

describe("takeoff offer — every promise names code that exists", () => {
  it("offers four deliverables", () => {
    // A literal, so adding a fifth is a deliberate act that brings whoever
    // adds it through this file.
    expect(DELIVERABLES).toHaveLength(4);
  });

  it("gives every deliverable a title, a body and a way to check it", () => {
    for (const d of DELIVERABLES) {
      expect(d.title.trim(), d.id).not.toBe("");
      expect(d.body.trim(), d.id).not.toBe("");
      // `check` is not decoration: the offer's whole premise is that a
      // contractor can tell in ten seconds whether the answer is right. A
      // deliverable nobody can check is one we should not be promising.
      expect(d.check.trim(), d.id).not.toBe("");
    }
  });

  it("uses a distinct id per deliverable", () => {
    const ids = DELIVERABLES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("backs every stage promise with a stage that is actually built", () => {
    const staged = DELIVERABLES.filter((d) => d.backing.kind === "stage");
    expect(staged.length).toBeGreaterThan(0);
    for (const d of staged) {
      const stage = d.backing.kind === "stage" ? d.backing.stage : "";
      expect(
        BUILT_STAGES.has(stage),
        `"${d.title}" is promised on stage ${stage}, which stages.ts does not build. ` +
          `Built: ${[...BUILT_STAGES].join(", ")}. A page may not offer an unbuilt stage.`,
      ).toBe(true);
    }
  });

  it("backs every module promise with a symbol that file exports", () => {
    const moduleBacked = DELIVERABLES.filter((d) => d.backing.kind === "module");
    expect(moduleBacked.length).toBeGreaterThan(0);
    for (const d of moduleBacked) {
      if (d.backing.kind !== "module") continue;
      const path = resolve(webDir, d.backing.path);
      expect(existsSync(path), `${d.backing.path} does not exist`).toBe(true);
      const source = readFileSync(path, "utf8");
      const exported = new RegExp(
        `export\\s+(?:async\\s+)?(?:function|const|type)\\s+${d.backing.symbol}\\b`,
      ).test(source);
      expect(
        exported,
        `"${d.title}" is promised on ${d.backing.path}#${d.backing.symbol}, which that file does not export.`,
      ).toBe(true);
    }
  });

  it("states limits as plainly as promises", () => {
    expect(LIMITS.length).toBeGreaterThanOrEqual(4);
    for (const limit of LIMITS) expect(limit.trim()).not.toBe("");
  });

  it("does not promise wall measurement, which is not a stage", () => {
    // The specific over-promise this offer is one honest sentence away from.
    // `wallVectors` and the scale reader run in the plan viewer with a person
    // present; neither is in STAGE_WORK, so neither can be mailed back.
    // Asserted rather than trusted to the comment in the module.
    const promised = DELIVERABLES.map((d) => `${d.title} ${d.body}`).join(" ").toLowerCase();
    expect(promised).not.toMatch(/linear feet|lineal feet|wall quantit|we measure|square footage/);
    expect(LIMITS.join(" ").toLowerCase()).toMatch(/measure/);
  });
});

describe("takeoff offer — the promises exist in exactly one place", () => {
  it("walked the app's own sources", () => {
    // The scope assertion. A corpus that resolved to nothing would make every
    // "no second copy" check below pass on an empty set.
    expect(corpus.length).toBeGreaterThan(400);
    expect(corpus.some((f) => f === OFFER_MODULE)).toBe(true);
  });

  it("carries no hand-written second copy of any promise", () => {
    const promises = new Set<string>([
      ...DELIVERABLES.map((d) => d.title),
      ...DELIVERABLES.map((d) => d.body),
      ...LIMITS,
      DELIVERY.form,
      DELIVERY.intake,
    ]);

    const offenders: string[] = [];
    for (const file of corpus) {
      if (ALLOWED_LITERAL_FILES.has(file)) continue;
      // Comments are not nodes to the parser, so a promise quoted in a header
      // comment cannot trip this — the #185 shape, avoided by construction
      // rather than by a stripper.
      for (const literal of fileLiterals(file)) {
        if (promises.has(literal.text.trim())) {
          offenders.push(`${basename(file)}: "${literal.text.trim().slice(0, 60)}…"`);
        }
      }
    }

    expect(
      offenders,
      "These files restate a promise from takeoff-offer.ts as their own literal. " +
        "Render it from DELIVERABLES/LIMITS/DELIVERY instead — a promise that can " +
        "drift between the page and the email is a promise we did not keep.",
    ).toEqual([]);
  });

  it("has the landing component read the real list", () => {
    // The other direction, and the one a completeness test cannot see: the
    // list can be perfect and unimported. CLAUDE.md records that exact shape
    // going green — a rate list restored as a local copy while the test
    // pinning the canonical one passed.
    expect(existsSync(LANDING_COMPONENT)).toBe(true);
    const source = readFileSync(LANDING_COMPONENT, "utf8");
    for (const symbol of ["DELIVERABLES", "LIMITS", "NEXT_STEPS", "DELIVERY"]) {
      expect(source, `WallTakeoffOffer.tsx does not read ${symbol}`).toContain(symbol);
    }
    // Named, not just imported: an import with no map is the dead-code shape.
    expect(source).toMatch(/DELIVERABLES\.map/);
    expect(source).toMatch(/LIMITS\.map/);
    expect(source).toMatch(/NEXT_STEPS\.map/);
  });

  it("derives the third step from DELIVERY rather than restating it", () => {
    const third = NEXT_STEPS.find((s) => s.step === 3);
    expect(third).toBeDefined();
    expect(third?.body).toContain(DELIVERY.form);
    expect(third?.body).toContain(DELIVERY.turnaround);
  });
});

describe("takeoff offer — the email check does not drift from the real one", () => {
  // The deliberate second copy, pinned. `looksLikeEmailAddress` exists so a
  // public page need not import the package that carries the model SDK; this
  // is the price of that, paid in one table.
  const cases = [
    "a@b.co",
    "cyrus@example.com",
    "first.last+tag@sub.domain.example",
    "UPPER@EXAMPLE.COM",
    "  padded@example.com  ",
    "",
    "a",
    "@example.com",
    "nodomain@",
    "no-at-sign.example.com",
    "two@at@example.com",
    "spaces in@example.com",
    "trailing@example.",
    "@",
    "a@b",
    `${"x".repeat(320)}@example.com`,
  ];

  it("agrees with looksLikeEmail on every case", () => {
    for (const value of cases) {
      expect(looksLikeEmailAddress(value), JSON.stringify(value)).toBe(looksLikeEmail(value));
    }
  });

  it("tested both answers", () => {
    // Without this the table could be all-true or all-false and still agree.
    const results = cases.map((c) => looksLikeEmailAddress(c));
    expect(results).toContain(true);
    expect(results).toContain(false);
  });
});

describe("takeoff offer — the request form", () => {
  const good: OfferRequest = {
    companyName: "Alvarado Drywall",
    contactName: "Rafael Alvarado",
    email: "rafael@alvaradodrywall.com",
    phone: "702-555-0130",
    trade: "FRAMING_DRYWALL",
    projectName: "Sunrise Medical Office Building",
    gcName: "Martin Harris Construction",
  };

  it("accepts a filled-in request", () => {
    expect(requestProblem(good)).toBeNull();
  });

  it("accepts a request with only the three required fields", () => {
    expect(
      requestProblem({ ...good, phone: "", trade: "", projectName: "", gcName: "" }),
    ).toBeNull();
  });

  it("names the missing field rather than listing every rule", () => {
    expect(requestProblem({ ...good, companyName: "  " })).toMatch(/company name/i);
    expect(requestProblem({ ...good, contactName: "" })).toMatch(/your name/i);
    expect(requestProblem({ ...good, email: "" })).toMatch(/email/i);
    expect(requestProblem({ ...good, email: "not-an-address" })).toMatch(/does not look right/i);
  });

  it("refuses a trade that is not on the list", () => {
    expect(requestProblem({ ...good, trade: "PLUMBING" })).toMatch(/trades listed/i);
  });

  it("offers every served trade plus an honest escape hatch", () => {
    expect(OFFER_TRADE_VALUES).toContain("OTHER");
    expect(OFFER_TRADES.length).toBeGreaterThanOrEqual(5);
    for (const trade of OFFER_TRADES) expect(offerTradeLabel(trade.value)).toBe(trade.label);
    expect(offerTradeLabel("PLUMBING")).toBeNull();
  });

  it("keeps everything typed that has no column, in the first activity", () => {
    const note = requestNote(good);
    expect(note).toContain("Metal framing & drywall");
    expect(note).toContain("Sunrise Medical Office Building");
    expect(note).toContain("Martin Harris Construction");
    expect(note).toContain("702-555-0130");
    expect(note).toContain("/wall-takeoff");
  });

  it("writes no empty labels for the fields they skipped", () => {
    const note = requestNote({ ...good, phone: "", gcName: "", projectName: "", trade: "" });
    expect(note).not.toMatch(/Phone:|GC:|Project:|Trade:/);
    expect(note.trim()).not.toBe("");
  });

  it("tells them the next move is theirs", () => {
    const { heading, body } = confirmation(good);
    expect(heading).toContain("Rafael");
    // The failure this guards is a confirmation that says "we'll be in touch"
    // while nothing can happen until they send the set.
    expect(body.toLowerCase()).toMatch(/attach|send/);
    expect(body).toContain(DELIVERY.turnaround);
  });

  it("does not render an empty name into the heading", () => {
    expect(confirmation({ ...good, contactName: "" }).heading).not.toMatch(/^\s*—/);
  });
});

describe("takeoff offer — an unauthenticated form's two ceilings", () => {
  const now = new Date("2026-10-08T17:00:00.000Z");

  it("treats a resubmission inside the window as the same request", () => {
    expect(withinDedupeWindow(new Date("2026-10-08T16:59:00.000Z"), now)).toBe(true);
    expect(withinDedupeWindow(new Date("2026-10-07T18:00:00.000Z"), now)).toBe(true);
  });

  it("treats a request after the window as a new one", () => {
    expect(withinDedupeWindow(new Date("2026-10-07T16:00:00.000Z"), now)).toBe(false);
  });

  it("ignores a row stamped in the future rather than trusting the arithmetic", () => {
    expect(withinDedupeWindow(new Date("2026-10-09T00:00:00.000Z"), now)).toBe(false);
  });

  it("stops at the hourly ceiling", () => {
    expect(overCeiling(HOURLY_LEAD_CEILING - 1)).toBe(false);
    expect(overCeiling(HOURLY_LEAD_CEILING)).toBe(true);
    expect(overCeiling(HOURLY_LEAD_CEILING + 50)).toBe(true);
  });

  it("sets both ceilings somewhere a real day of inbound never reaches", () => {
    expect(DEDUPE_WINDOW_HOURS).toBeGreaterThanOrEqual(1);
    expect(HOURLY_LEAD_CEILING).toBeGreaterThan(5);
  });
});
