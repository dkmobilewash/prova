import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { looksLikeEmail } from "@prova/integrations";

import type { ScheduleProposalView } from "@/components/ScheduleProposals";

import { appSourceFiles, fileLiterals } from "./source-literals";
import type { SheetRow, SheetStatus } from "./plan-ingest/sheetIndex";
import { deliveryBody, deliverySubjectLine, type DeliveredRead } from "./takeoff-delivery";
import {
  DELIVERABLES,
  DELIVERY,
  DEDUPE_WINDOW_HOURS,
  HOURLY_LEAD_CEILING,
  LIMITS,
  NEXT_STEPS,
  OFFER_TRADES,
  OFFER_TRADE_VALUES,
  WHAT_IT_FEEDS,
  confirmation,
  looksLikeEmailAddress,
  offerTradeLabel,
  overCeiling,
  requestNote,
  requestProblem,
  withinDedupeWindow,
  type Backing,
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

/**
 * THE ONE RESOLVER, and the reason it is a function rather than two copies of
 * the same twelve lines.
 *
 * `DELIVERABLES` and `WHAT_IT_FEEDS` both carry a `Backing`, and both lists
 * are read by the same public page. A second copy of this logic is the exact
 * shape CLAUDE.md records going green: a completeness guard cannot see a
 * consumer that stopped reading the canonical thing, and a resolver that was
 * copied and then loosened on one side would let the new list promise a symbol
 * that does not exist while the old list's test stayed honest. So there is one
 * of these, and every list goes through it.
 *
 * `label` is only ever used in the failure message — it has to name WHICH line
 * of the offer is unbacked, because "a symbol does not exist" with no
 * sentence attached sends whoever reads the failure to the wrong list.
 */
function expectBackingResolves(backing: Backing, label: string): void {
  if (backing.kind === "stage") {
    expect(
      BUILT_STAGES.has(backing.stage),
      `"${label}" is promised on stage ${backing.stage}, which stages.ts does not build. ` +
        `Built: ${[...BUILT_STAGES].join(", ")}. A page may not offer an unbuilt stage.`,
    ).toBe(true);
    return;
  }
  const path = resolve(webDir, backing.path);
  expect(existsSync(path), `${backing.path} does not exist`).toBe(true);
  const source = readFileSync(path, "utf8");
  const exported = new RegExp(
    `export\\s+(?:async\\s+)?(?:function|const|type)\\s+${backing.symbol}\\b`,
  ).test(source);
  expect(
    exported,
    `"${label}" is promised on ${backing.path}#${backing.symbol}, which that file does not export.`,
  ).toBe(true);
}

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
    for (const d of staged) expectBackingResolves(d.backing, d.title);
  });

  it("backs every module promise with a symbol that file exports", () => {
    const moduleBacked = DELIVERABLES.filter((d) => d.backing.kind === "module");
    expect(moduleBacked.length).toBeGreaterThan(0);
    for (const d of moduleBacked) expectBackingResolves(d.backing, d.title);
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

describe("takeoff offer — what the free read is the front half of", () => {
  it("names at least three chains", () => {
    // THE SIZE ASSERTION, and the only reason the two checks below mean
    // anything. This file's own header states the rule: a check that DERIVES
    // its input has two failure modes and only one of them looks like a
    // failure. An empty `WHAT_IT_FEEDS` satisfies every loop here — nothing is
    // ever missing from an empty list, no backing fails to resolve in it, and
    // its joined text matches no over-promise. Three is what the page ships
    // and what the module's own header argues for, so going below it is a
    // deliberate act that comes through this test.
    expect(WHAT_IT_FEEDS.length).toBeGreaterThanOrEqual(3);
  });

  it("gives every entry both halves and a distinct id", () => {
    for (const fed of WHAT_IT_FEEDS) {
      expect(fed.handed.trim(), fed.id).not.toBe("");
      // `feeds` is the half that makes the section worth having. An entry with
      // only `handed` restates a deliverable and says nothing about what it is
      // for, which is the defect this whole section was added to fix.
      expect(fed.feeds.trim(), fed.id).not.toBe("");
    }
    const ids = WHAT_IT_FEEDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves every chain through the same resolver the deliverables use", () => {
    // Not a copy of the deliverables' check — literally the same function, so
    // the two lists cannot drift into two standards of evidence.
    expect(WHAT_IT_FEEDS.length).toBeGreaterThan(0);
    for (const fed of WHAT_IT_FEEDS) expectBackingResolves(fed.backing, fed.handed);
  });

  it("backs every chain with a module symbol rather than a stage", () => {
    // Deliberate, and the distinction the section rests on: these chains are
    // work a person does in the app, not a stage that runs on an upload. A
    // stage backing here would be a claim that the chain happens unattended,
    // which is the one thing this section may not say.
    for (const fed of WHAT_IT_FEEDS) {
      expect(fed.backing.kind, fed.id).toBe("module");
    }
  });

  it("does not claim the measuring happens without a person", () => {
    // The same shape as "does not promise wall measurement" above, pointed at
    // the new section — because this is the section most likely to drift into
    // it. Naming the takeoff as what the free read feeds is honest; naming it
    // as something that arrives in an inbox is not, and the two readings are
    // one sentence apart.
    const text = WHAT_IT_FEEDS.map((f) => `${f.handed} ${f.feeds}`).join(" ").toLowerCase();
    // Non-vacuity before the negative assertion, for the reason the watcher
    // entry in CLAUDE.md gives: a needle that could never be present proves
    // nothing, and neither does an empty haystack.
    expect(text.length).toBeGreaterThan(200);
    expect(text).not.toMatch(/we measure|we take off|linear feet|lineal feet|wall quantit/);
    // And the limits still say it out loud, so the two sections agree.
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
      ...WHAT_IT_FEEDS.map((f) => f.handed),
      ...WHAT_IT_FEEDS.map((f) => f.feeds),
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
        "Render it from DELIVERABLES/WHAT_IT_FEEDS/LIMITS/DELIVERY instead — a promise that can " +
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
    for (const symbol of ["DELIVERABLES", "WHAT_IT_FEEDS", "LIMITS", "NEXT_STEPS", "DELIVERY"]) {
      expect(source, `WallTakeoffOffer.tsx does not read ${symbol}`).toContain(symbol);
    }
    // Named, not just imported: an import with no map is the dead-code shape.
    expect(source).toMatch(/DELIVERABLES\.map/);
    expect(source).toMatch(/WHAT_IT_FEEDS\.map/);
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
    const { heading, body } = confirmation(good, "office@example.com");
    expect(heading).toContain("Rafael");
    // The failure this guards is a confirmation that says "we'll be in touch"
    // while nothing can happen until they send the set.
    expect(body.toLowerCase()).toMatch(/send/);
    expect(body).toContain(DELIVERY.turnaround);
  });

  it("names the address IN the sentence, not somewhere else on the page", () => {
    // THIS IS A REGRESSION TEST FOR A BUG THAT REACHED NO FURTHER THAN THIS
    // BRANCH, and it is worth a test rather than a comment because the broken
    // version read perfectly. It said "reply to the email we just sent" —
    // and `requestDrawingSetRead` sends no email, deliberately, so that an
    // install with no mail provider can still take a request. The on-screen
    // address is therefore the whole mechanism.
    //
    // A sentence that points at the layout instead ("the address below") is
    // true until somebody moves the box, and a sentence that names a channel
    // we do not use is never true. So the address has to be in the words.
    const body = confirmation(good, "drawings@cstream.example").body;
    expect(body).toContain("drawings@cstream.example");
    // The pattern names the FALSE CHANNEL and the LAYOUT POINTER, not the
    // word "link" — which the honest sentence legitimately contains, in "no
    // link to click". The first version of this assertion matched /link/ and
    // went red against the correct copy, which is its own small lesson: a
    // negative assertion has to name the defect, not a word near it.
    expect(body.toLowerCase()).not.toMatch(
      /we just sent|email we sent|reply to the email|address below|address at the bottom/,
    );
  });

  it("does not render an empty name into the heading", () => {
    expect(confirmation({ ...good, contactName: "" }, "office@example.com").heading).not.toMatch(
      /^\s*—/,
    );
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

describe("takeoff offer — nothing promises what the delivery form denies", () => {
  /**
   * THE DEFECT THIS EXISTS FOR SHIPPED, AND IT SHIPPED THROUGH A CORRECTION.
   *
   * `DELIVERY.form`'s own comment records a share-link being promised while
   * nothing minted one, the plan being dropped in favour of the read going in
   * the mail body, and the stale sentence being caught by a person. The
   * sentence was then fixed and THREE MORE SITES SURVIVED — `NEXT_STEPS` step
   * 3's title ("We email you the link"), which the page renders DIRECTLY ABOVE
   * `DELIVERY.form` itself, so one list item contradicted itself in two
   * adjacent lines on a public page; `requestProblem`'s empty-email sentence;
   * and `DELIVERY`'s own header paragraph.
   *
   * No test here could see it. The second-copy census above fails on a
   * duplicated promise STRING, and none of these was a duplicate — they were
   * three different sentences making a claim a fourth sentence denies. A
   * contradiction is not a copy.
   *
   * ── WHY THE DENIALS ARE DERIVED RATHER THAN LISTED ──
   *
   * CLAUDE.md's rule, applied to prose: a guard with a hand-typed needle list
   * stops being about the promise the moment the promise changes. So the words
   * come out of `DELIVERY.form` — the one sentence that is authoritative about
   * how the result arrives — and if that sentence ever says "no spreadsheet",
   * this test starts policing the word "spreadsheet" with no edit here. If the
   * link ever comes back, `form` says so first and the whole check relaxes with
   * it, which is the only safe direction for a promise to move.
   *
   * ── WHAT COUNTS AS PROMISING IT ──
   *
   * A denied noun may appear ONLY immediately after "no". That is how
   * `DELIVERY.form` itself says it ("no link to click"), and it is the
   * difference the first version of the confirmation test got wrong: a
   * negative assertion matching the bare word /link/ went red against the
   * CORRECT copy. Denying a link is the promise; mentioning one is the bug.
   */
  const DENIED = [...DELIVERY.form.matchAll(/\bno ([a-z]+)\b/g)].map((m) => m[1]!);

  it("derived the denials from the delivery form rather than a list typed here", () => {
    // THE SIZE ASSERTION, by a second expression sharing no regex with the
    // first. A pattern that matched nothing would make every check below pass
    // on an empty needle set — nothing is ever missing from an empty list.
    expect(DENIED.length).toBe(DELIVERY.form.split(/\bno /).length - 1);
    expect(DENIED.length).toBeGreaterThanOrEqual(3);
    // Non-vacuity of the DENIALS themselves: `form` has to be a sentence that
    // actually refuses things, or there is nothing to police.
    expect(DENIED).toContain("link");
  });

  /** Every occurrence of a denied noun that is NOT preceded by "no". */
  function promisesDenied(text: string): string[] {
    const found: string[] = [];
    for (const noun of DENIED) {
      for (const match of text.matchAll(new RegExp(`(\\bno\\s+)?\\b${noun}\\b`, "gi"))) {
        if (!match[1]) found.push(noun);
      }
    }
    return found;
  }

  it("can tell a promise from a denial", () => {
    // The instrument's own positive and negative control, before it is pointed
    // at anything. Without this the sweep below could be a function that
    // returns [] for every input, and every assertion under it would pass.
    expect(promisesDenied("We email you the link")).toContain("link");
    expect(promisesDenied("We will send a link to a page with your account")).toEqual(
      expect.arrayContaining(["link", "account"]),
    );
    expect(promisesDenied("no link to click, no login, no account")).toEqual([]);
    // And the authoritative sentence passes its own rule, which is the proof
    // that the rule is the one `DELIVERY.form` is written to.
    expect(promisesDenied(DELIVERY.form)).toEqual([]);
  });

  /**
   * `requestProblem`'s refusals, one per branch — collected by running it
   * rather than read off the source, because a sentence nobody can reach is
   * not a promise and a sentence the source does not show is still shown to a
   * contractor.
   */
  const refusals = (
    [
      { companyName: "  " },
      { contactName: "" },
      { email: "" },
      { email: "not-an-address" },
      { trade: "PLUMBING" },
    ] as Partial<OfferRequest>[]
  ).map((patch) =>
    requestProblem({
      companyName: "Alvarado Drywall",
      contactName: "Rafael Alvarado",
      email: "rafael@alvaradodrywall.com",
      phone: "",
      trade: "FRAMING_DRYWALL",
      projectName: "",
      gcName: "",
      ...patch,
    }),
  );

  it("reached every refusal branch", () => {
    // The scope assertion for the sweep below: a patch table that stopped
    // tripping a branch would quietly shrink the text being checked, and a
    // null in it is a branch that returned nothing to read.
    expect(refusals).toHaveLength(5);
    for (const refusal of refusals) expect(refusal).not.toBeNull();
    expect(new Set(refusals).size).toBe(refusals.length);
  });

  it("promises no link, attachment, login or account anywhere in the offer", () => {
    const sentences: { where: string; text: string }[] = [
      ...DELIVERABLES.flatMap((d) => [
        { where: `DELIVERABLES[${d.id}].title`, text: d.title },
        { where: `DELIVERABLES[${d.id}].body`, text: d.body },
        { where: `DELIVERABLES[${d.id}].check`, text: d.check },
      ]),
      ...WHAT_IT_FEEDS.flatMap((f) => [
        { where: `WHAT_IT_FEEDS[${f.id}].handed`, text: f.handed },
        { where: `WHAT_IT_FEEDS[${f.id}].feeds`, text: f.feeds },
      ]),
      ...NEXT_STEPS.flatMap((s) => [
        { where: `NEXT_STEPS[${s.step}].title`, text: s.title },
        { where: `NEXT_STEPS[${s.step}].body`, text: s.body },
      ]),
      ...LIMITS.map((limit, index) => ({ where: `LIMITS[${index}]`, text: limit })),
      ...Object.entries(DELIVERY).map(([key, value]) => ({
        where: `DELIVERY.${key}`,
        text: value,
      })),
      ...refusals.map((text, index) => ({
        where: `requestProblem #${index}`,
        text: text ?? "",
      })),
      // The confirmation state is rendered from `DELIVERY.form` and so should
      // pass by construction — which is exactly why it is in here. A future
      // edit that restates the sentence instead of interpolating it lands in
      // this sweep rather than on a page.
      ...(() => {
        const { heading, body } = confirmation(
          {
            companyName: "Alvarado Drywall",
            contactName: "Rafael Alvarado",
            email: "rafael@alvaradodrywall.com",
            phone: "",
            trade: "FRAMING_DRYWALL",
            projectName: "",
            gcName: "",
          },
          "drawings@cstream.example",
        );
        return [
          { where: "confirmation().heading", text: heading },
          { where: "confirmation().body", text: body },
        ];
      })(),
    ];

    // The haystack's own size assertion. This list is assembled from five
    // sources and a bad spread could silently reduce it to nothing.
    expect(sentences.length).toBeGreaterThanOrEqual(25);
    for (const sentence of sentences) expect(sentence.text.trim(), sentence.where).not.toBe("");

    const offenders = sentences
      .flatMap(({ where, text }) => promisesDenied(text).map((noun) => `${where}: "${noun}"`))
      .sort();

    expect(
      offenders,
      `DELIVERY.form denies ${DENIED.join(", ")} — "${DELIVERY.form}". ` +
        "These lines of the offer promise one of them anyway. The page is what a " +
        "contractor agreed to before handing over a bid set, and two of its own " +
        "sentences disagreeing is worse than either alone. Either the offer line is " +
        "wrong, or DELIVERY.form is — and the one that changes is the one the " +
        "delivery code does not match.",
    ).toEqual([]);
  });
});

/**
 * EVERY DELIVERABLE, AGAINST THE EMAIL THAT IS SUPPOSED TO CARRY IT.
 *
 * ── THE GAP THIS CLOSES, WHICH IS WORTH MORE THAN THE DEFECT IT FOUND ──
 *
 * `expectBackingResolves` above proves a deliverable names a pipeline STAGE
 * that `stages.ts` builds, or a module symbol that exists. Both are questions
 * about the INPUT. Nothing anywhere related a deliverable to the email's
 * OUTPUT — and `lib/takeoff-delivery.ts` is the whole of what a contractor
 * receives.
 *
 * So `page-inventory` promised "Page count, sheet size per page, and which
 * pages have no text layer at all" and shipped with two thirds of it absent:
 * `PlanSheetText` records `widthPt`/`heightPt`, `SheetRow` does not carry
 * them, and NO SECTION OF `deliveryBody` PRINTS A SIZE. Every check in this
 * repo was green — the stage runs, the stage is built, the backing resolved.
 * CLAUDE.md's line for it: nothing is ever missing from a question nobody is
 * asking.
 *
 * The promise was narrowed rather than the renderer extended, because adding a
 * size means changing `SheetRow` in `lib/plan-ingest/sheetIndex.ts`, which the
 * review screen shares. Narrowing is also the honest direction for a page like
 * this: a free tool that over-promises costs more than one that offers less.
 *
 * ── WHY THIS IS NOT A KEYWORD MATCH ON THE PROMISE TEXT ──
 *
 * Two reasons, and they point the same way. The second-copy census above
 * forbids retyping a promise string anywhere, so the needles could not be the
 * promises. And a keyword match would pass on a coincidence — "page" appears
 * in the index table's own column header, so a promise about pages would
 * "verify" against a heading the renderer prints whatever happened upstream.
 *
 * So each deliverable names a DISCRIMINATOR: something in the rendered email
 * that can only be there if the email really carries that deliverable. Each
 * one says below why it cannot pass vacuously.
 */
describe("takeoff offer — every deliverable is in the email that delivers it", () => {
  function sheet(
    pageNumber: number,
    options: {
      hasTextLayer?: boolean;
      sheetNumber?: string | null;
      title?: string | null;
      discipline?: string | null;
      status?: SheetStatus;
      acceptedSheetNumber?: string | null;
      acceptedTitle?: string | null;
    } = {},
  ): SheetRow {
    const hasTextLayer = options.hasTextLayer ?? true;
    return {
      pageNumber,
      hasTextLayer,
      // A scan never has a proposal and never will until somebody types the
      // number in — `sheetIndex.ts`'s own reason for `proposal` being null.
      proposal: hasTextLayer
        ? {
            id: `prop-${pageNumber}`,
            sheetNumber: options.sheetNumber ?? null,
            title: options.title ?? null,
            discipline: options.discipline ?? null,
            pageType: null,
            scale: null,
            revision: null,
            issueDate: null,
            reason: "read off the title block",
            confidence: "HIGH",
            status: options.status ?? "PROPOSED",
            acceptedSheetNumber: options.acceptedSheetNumber ?? null,
            acceptedTitle: options.acceptedTitle ?? null,
          }
        : null,
    };
  }

  /**
   * One set that exercises all four deliverables at once: pages that read
   * cleanly, a scan with no text layer, the same sheet number on two pages
   * spelled two different ways, and a schedule with a cell value nothing else
   * in the output could produce.
   */
  const SHEETS: SheetRow[] = [
    sheet(1, { sheetNumber: "G-001", title: "Cover Sheet", discipline: "General" }),
    sheet(2, { sheetNumber: "A-101", title: "Floor Plan", discipline: "Architectural" }),
    // The scan. Page 3 and nothing else about it.
    sheet(3, { hasTextLayer: false }),
    // The duplicate, written the way a different title block prints it — so
    // only real case-and-whitespace normalisation reaches page 5.
    sheet(5, { sheetNumber: "a-101 ", title: "Floor Plan", discipline: "Architectural" }),
    sheet(8, { sheetNumber: "A-601", title: "Partition Types", discipline: "Architectural" }),
  ];

  const SCHEDULE: ScheduleProposalView = {
    id: "sched-partition",
    pageNumber: 8,
    sheetNumber: "A-601",
    kind: "PARTITION",
    title: "PARTITION SCHEDULE",
    rows: [
      {
        mark: "P1",
        description: "One-hour rated partition",
        size: "five eighths gypsum, both faces",
        quantity: 12,
        notes: "deck to deck",
      },
    ],
    reason: "grid read off the sheet",
    confidence: "HIGH",
    gridRowCount: 1,
    readRowCount: 1,
  };

  const read: DeliveredRead = {
    subject: {
      companyName: "Alvarado Drywall",
      contactName: "Rafael Alvarado",
      projectName: "Sunrise Medical Office Building",
      fileName: "Sunrise-bid-set.pdf",
    },
    sheets: SHEETS,
    schedules: [SCHEDULE],
  };

  const subject = deliverySubjectLine(read);
  const body = deliveryBody(read);
  /** The email is the subject line and the body. Both are what arrives, and
   *  the sheet COUNT is only ever in the subject. */
  const email = `${subject}\n\n${body}`;

  /**
   * Per deliverable: what must be in the email, and why each needle cannot be
   * true unless that deliverable really shipped.
   */
  const DISCRIMINATORS: Record<string, { needles: (string | RegExp)[]; why: string }> = {
    "sheet-index": {
      // The heading is `indexSection`'s own literal, and the row regex demands
      // page number, sheet number, title AND discipline from the fixture on
      // ONE line in the renderer's column order. No other section of this file
      // emits a line of that shape, and nothing can produce it from the
      // headings alone — a `.map` that rendered nothing leaves the heading and
      // loses the row.
      needles: ["EVERY SHEET, AS WE READ IT", /^\s*2\s{2,}A-101\s{2,}Floor Plan\s{2,}Architectural$/m],
      why: "a table row carrying all four fixture values in one line",
    },
    "duplicate-sheets": {
      // `pagesForSheetNumber` computes the page list, and page 5 is spelled
      // "a-101 " in the fixture — lower case with a trailing space. "pages 2
      // and 5" can therefore only appear if the duplicate detection and the
      // page lookup both normalised it. A literal pair of page numbers is not
      // reachable by coincidence: no other line in this email names two pages.
      needles: ["THE SAME SHEET NUMBER ON MORE THAN ONE PAGE", "A-101 — pages 2 and 5."],
      why: "the duplicate's page pair, reached only through normalisation",
    },
    schedules: {
      // A CELL VALUE, which is the only thing that proves rows were typed out
      // rather than a heading rendered: "deck to deck" exists nowhere in the
      // app and can only come from this fixture row's `notes`. The location
      // line proves the other half of the promise — "with the sheet each one
      // came off" — by naming the fixture's sheet number and page together.
      needles: ["SCHEDULES WE READ", "PARTITION SCHEDULE — sheet A-601, page 8", "deck to deck", "One-hour rated partition"],
      why: "a schedule cell value and the sheet it came off",
    },
    "page-inventory": {
      // The scan sentence is `couldNotReadSection`'s, and it names the fixture's
      // scanned page by number — page 3 is the ONLY row with `hasTextLayer:
      // false`, so this sentence cannot appear without that row having been
      // classified. "5 sheets" is `countSheets` over the fixture's five rows,
      // in the subject line; it is a different number from every page number
      // in the set, so it cannot be a page number read by accident.
      needles: [/Page 3 is a scan — there is no text on it at all/, "5 sheets"],
      why: "the scanned page named by number, and the set's own page count",
    },
  };

  it("has a discriminator for every deliverable", () => {
    // The scope assertion, and the half that keeps this honest as the offer
    // grows: a fifth deliverable with nothing proving it reaches the email is
    // exactly the defect above. Adding one brings whoever adds it through here.
    expect(Object.keys(DISCRIMINATORS).sort()).toEqual(DELIVERABLES.map((d) => d.id).sort());
    expect(DELIVERABLES.length).toBeGreaterThanOrEqual(4);
  });

  it("rendered an email worth asserting against", () => {
    // The non-vacuity floor. An empty body satisfies no `toContain`, but an
    // exception swallowed into an empty string would make the failures read as
    // four missing deliverables rather than one broken renderer.
    expect(body.length).toBeGreaterThan(400);
    expect(SHEETS).toHaveLength(5);
    expect(SHEETS.filter((s) => !s.hasTextLayer)).toHaveLength(1);
    expect(SCHEDULE.rows).toHaveLength(1);
  });

  for (const deliverable of DELIVERABLES) {
    it(`delivers "${deliverable.id}" — ${DISCRIMINATORS[deliverable.id]?.why ?? "NO DISCRIMINATOR"}`, () => {
      const entry = DISCRIMINATORS[deliverable.id];
      expect(entry, `no discriminator for ${deliverable.id}`).toBeDefined();
      for (const needle of entry!.needles) {
        const message =
          `The offer promises "${deliverable.title}" — ${deliverable.body} ` +
          `Nothing in the delivered email answers for it. Either the email stopped ` +
          `carrying it or the page is promising something we do not send.`;
        if (typeof needle === "string") {
          expect(email, message).toContain(needle);
        } else {
          expect(email, message).toMatch(needle);
        }
      }
    });
  }

  /**
   * AND THE OTHER DIRECTION: a promise that claims something the renderer has
   * no field for.
   *
   * The discriminators above catch a deliverable the email stopped carrying.
   * They cannot catch a deliverable that GREW a clause, because a new clause
   * adds no needle. That is how the sheet-size promise shipped: every needle
   * for `page-inventory` would have matched with the clause present or absent.
   *
   * So each entry here pairs a CLAIM pattern, matched against the promise
   * text, with the EVIDENCE that claim would leave in the email. The rule only
   * engages when a promise makes the claim — and then the email has to show it.
   */
  const CLAIMS: { what: string; claim: RegExp; evidence: RegExp }[] = [
    {
      what: "a sheet or page SIZE",
      // `SheetRow` carries no `widthPt`/`heightPt` and no section of
      // `takeoff-delivery.ts` prints a dimension, so this claim cannot be kept
      // without a change to `lib/plan-ingest/sheetIndex.ts` as well.
      claim: /\b(?:sheet|page|paper)\s+sizes?\b|\bsizes?\s+(?:of|per)\s+(?:each\s+|every\s+)?(?:sheet|page)\b/i,
      evidence: /\b\d+(?:\.\d+)?\s*(?:x|×)\s*\d+|\barch\s+[a-e]\b|\b\d+\s*(?:in\.?|")\s*(?:x|×)/i,
    },
    {
      what: "a REVISION or an ISSUE DATE",
      // Both are on the proposal and neither is a column in `indexSection`.
      claim: /\brevisions?\b|\bissue dates?\b|\brevision dates?\b/i,
      evidence: /\bRevision\b|\bIssued\b/,
    },
  ];

  it("can tell a claim from the clause that made it", () => {
    // THE INSTRUMENT'S CONTROL, and it is the exact defect rather than an
    // invented one: this is the clause `page-inventory` shipped with. If the
    // claim pattern ever stops matching it, the rule below is inert and this
    // line says so instead of passing quietly.
    const asShipped = "Page count, sheet size per page, and which pages have no text layer at all";
    expect(CLAIMS[0]!.claim.test(asShipped)).toBe(true);
    // The negative half, on a sentence no promise edit can reach — so a real
    // defect reds the assertion below and NEVER this control. CLAUDE.md is
    // explicit that a failing control is an instruction to fix the harness
    // rather than a result to read, which is exactly what it would become if
    // it also asserted today's copy.
    expect(CLAIMS[0]!.claim.test("Your whole set listed out, in order")).toBe(false);
    // And the evidence half: the email really has no dimension in it, so a
    // restored clause fails on a missing size rather than finding one by
    // accident. 12 and the page numbers are in there; nothing of the form
    // 36 x 24 is.
    expect(CLAIMS[0]!.evidence.test(email)).toBe(false);
    expect(CLAIMS[1]!.claim.test("The revision of each sheet")).toBe(true);
    expect(CLAIMS[1]!.evidence.test(email)).toBe(false);
  });

  it("claims nothing the email has no field for", () => {
    const offenders: string[] = [];
    for (const deliverable of DELIVERABLES) {
      const text = `${deliverable.title} ${deliverable.body} ${deliverable.check}`;
      for (const { what, claim, evidence } of CLAIMS) {
        if (claim.test(text) && !evidence.test(email)) {
          offenders.push(`${deliverable.id} promises ${what}, and the email prints none`);
        }
      }
    }
    expect(
      offenders,
      "A deliverable claims something `lib/takeoff-delivery.ts` does not render. " +
        "Narrow the promise, or carry the field through SheetRow first — in that " +
        "order, because the page is what a contractor agreed to before sending us " +
        "a bid set they cannot un-send.",
    ).toEqual([]);
  });
});
