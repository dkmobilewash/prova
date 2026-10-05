// @vitest-environment happy-dom

/**
 * THE ORDER `/sales` IS READ IN, AND THE DEAD EXPORT THAT WAS SUPPOSED TO SET
 * IT.
 *
 * `lib/sales-qualification.ts` has exported `BAND_RANK` — "sort order for a
 * list of leads: the ones worth calling first" — since it was written, and
 * until this file the ONLY importer in the repo was its own unit test,
 * asserting that the four bands have four distinct ranks. Tested, documented,
 * and ordering nothing anybody could see: CLAUDE.md's "written, documented, and
 * never called" shape. `/sales` listed leads in creation order, so one imported
 * §4104 listing (up to 60 leads, all created in one transaction and therefore
 * all newer than everything already there) buried every lead worth ringing.
 *
 * ── WHAT EACH HALF OF THIS FILE CAN AND CANNOT SEE ──
 *
 * The first half tests the comparator over literals. The second half RENDERS
 * the list, because a comparator that sorts correctly proves nothing about what
 * reaches a screen — CLAUDE.md's expo-router entry is the expensive version of
 * that, three green PRs asserting a screen CONTAINED an option the framework
 * threw away. *"A census can tell you the code is THERE. It can never tell you
 * a framework HONOURS it."*
 *
 * What neither half can see: size, position and contrast. happy-dom does no
 * layout and returns zeros from `getBoundingClientRect`.
 *
 * ── THE MUTATION THIS FILE IS BUILT TO KILL ──
 *
 * **Make the ordering a no-op** — `compareForCalling` returning 0, so the list
 * comes back in the order it arrived. Every ordering test below is written
 * against input that is NOT already in band order, so that mutation reds them
 * rather than passing by coincidence. The second mutation is the tiebreak, and
 * the case that kills it is the odd one: 60 leads sharing a `createdAt` to the
 * millisecond, asserted to come out the same way from a REVERSED input. Sort
 * stability alone would return the reversal, so nothing weaker distinguishes a
 * real tiebreak from `Array.sort` being stable.
 *
 * `createElement` rather than JSX because this suite collects `.test.ts`, as
 * `salesLeadRegistry.test.ts` and `actionForm.test.ts` both do and say.
 */

import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* The row's own server-action import, which the ORDER has nothing to do with.
   Mocked so this file loads without the actions barrel and its Prisma client —
   nothing under test reads it. */
vi.mock("@/lib/actions", () => ({
  deleteSalesLead: async () => ({ ok: true }),
}));

/* `next/link` and `next/navigation` are mocked HERE rather than left to a
   config alias, and that distinction cost a red CI run: an earlier version of
   this file said they were "aliased to stubs by the config", which was true of
   the scratchpad config it was written against and false of `vitest.config.mts`.
   The five render tests passed locally and failed in CI with `invariant expected
   app router to be mounted` — a harness that was more permissive than the real
   one, so the green said nothing. Same shape and same mock as
   `components/Sidebar.test.ts`, which renders nav links for the same reason.
   Nothing here navigates; an anchor with the same href is all these read. */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/sales",
}));
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children?: ReactNode;
    } & Record<string, unknown>) => h("a", { href, ...rest }, children),
  };
});

import {
  SalesLeadList,
  type SalesLeadRowLead,
} from "@/components/SalesLeadRow";
import {
  compareForCalling,
  groupForCalling,
  orderForCalling,
  type CallOrderLead,
} from "@/lib/sales-lead-order";
import {
  BAND_LABELS,
  BAND_RANK,
  FIT_BANDS,
  type FitBand,
} from "@/lib/sales-qualification";

type Row = SalesLeadRowLead & CallOrderLead;

function lead(
  id: string,
  band: FitBand,
  createdAt: string,
  over: Partial<Row> = {},
): Row {
  return {
    id,
    companyName: `${id} Drywall`,
    contactName: null,
    email: null,
    phone: null,
    source: null,
    licenceNumber: null,
    city: null,
    listedByGc: null,
    opportunityCount: 0,
    lastContactOn: null,
    daysSinceContact: null,
    followUpOn: null,
    followUpStanding: null,
    band,
    bandReason: `because ${band}`,
    awaitingReview: 0,
    createdAt,
    ...over,
  };
}

const ids = (rows: readonly Row[]) => rows.map((r) => r.id);

describe("the order /sales is worked down", () => {
  it("puts the strongest band first, from an input that is not already in that order", () => {
    /* Creation order, newest first — exactly what the query returns and what
       the page used to render. The one lead worth ringing is at the BOTTOM,
       which is the defect. */
    const input = [
      lead("thin-new", "THIN", "2026-10-05T09:00:00.000Z"),
      lead("notafit", "NOT_A_FIT", "2026-10-04T09:00:00.000Z"),
      lead("worth", "WORTH_A_CALL", "2026-10-03T09:00:00.000Z"),
      lead("strong", "STRONG", "2026-10-02T09:00:00.000Z"),
    ];

    expect(ids(orderForCalling(input))).toEqual([
      "strong",
      "worth",
      "thin-new",
      "notafit",
    ]);
  });

  it("orders the whole ladder, not only the strongest band", () => {
    /* A literal sequence rather than one recomputed from BAND_RANK: a test that
       derives its expectation from the thing under test passes however wrong
       that thing becomes. Same reason `e2e/lib/salesFixture.ts` states its
       strings as literals. */
    const shuffled = [
      lead("c", "THIN", "2026-10-01T00:00:00.000Z"),
      lead("a", "NOT_A_FIT", "2026-10-01T00:00:00.000Z"),
      lead("d", "STRONG", "2026-10-01T00:00:00.000Z"),
      lead("b", "WORTH_A_CALL", "2026-10-01T00:00:00.000Z"),
    ];

    expect(orderForCalling(shuffled).map((r) => r.band)).toEqual([
      "STRONG",
      "WORTH_A_CALL",
      "THIN",
      "NOT_A_FIT",
    ]);
  });

  it("reads its ladder from BAND_RANK rather than a second copy of it", () => {
    /* Every ordered pair, so a comparator that hoists STRONG and leaves the
       other three in a heap cannot pass. This is the assertion that makes
       BAND_RANK a live dependency of the screen instead of an export with one
       test and no caller. */
    for (const a of FIT_BANDS) {
      for (const b of FIT_BANDS) {
        const got = Math.sign(
          compareForCalling(
            lead("x", a, "2026-10-01T00:00:00.000Z"),
            lead("x", b, "2026-10-01T00:00:00.000Z"),
          ),
        );
        expect(got, `${a} against ${b}`).toBe(
          Math.sign(BAND_RANK[a] - BAND_RANK[b]),
        );
      }
    }
  });

  it("ranks the band ABOVE recency, so an old strong lead beats a new thin one", () => {
    /* The case that distinguishes this from the createdAt sort the page already
       had: the strong lead is the OLDEST row in the list. */
    const input = [
      lead("thin-today", "THIN", "2026-10-05T23:59:59.999Z"),
      lead("strong-ancient", "STRONG", "2026-01-02T00:00:00.000Z"),
    ];

    expect(ids(orderForCalling(input))).toEqual([
      "strong-ancient",
      "thin-today",
    ]);
  });

  it("breaks a tie inside a band by recency, newest first", () => {
    const input = [
      lead("oldest", "WORTH_A_CALL", "2026-09-01T00:00:00.000Z"),
      lead("newest", "WORTH_A_CALL", "2026-10-05T00:00:00.000Z"),
      lead("middle", "WORTH_A_CALL", "2026-09-20T00:00:00.000Z"),
    ];

    expect(ids(orderForCalling(input))).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });

  it("is deterministic when a whole import shares one createdAt, whichever order the rows arrive in", () => {
    /**
     * THE CASE THE REST OF THE FILE CANNOT MAKE.
     *
     * `SalesLead.createdAt` is `DEFAULT CURRENT_TIMESTAMP`, which in Postgres is
     * the START OF THE TRANSACTION rather than the moment of the INSERT, and
     * `importSubListing` creates every lead inside one `prisma.$transaction`.
     * Measured against a real Postgres 16: three inserts 120ms apart in one
     * transaction, ONE distinct timestamp. So all 60 rows of an import tie, and
     * `ORDER BY createdAt DESC` is not a total order for the exact case this
     * list exists for — Postgres may hand tied rows back in any order.
     *
     * Asserting one expected sequence is not enough to prove a tiebreak: with
     * equal keys `Array.sort` is stable, so the input order would satisfy it.
     * This feeds the SAME rows in REVERSED order and requires the same output,
     * which stability cannot produce and only a real tiebreak can.
     */
    const sameInstant = "2026-10-05T08:11:06.088Z";
    const batch = [
      lead("ck03", "WORTH_A_CALL", sameInstant),
      lead("ck01", "WORTH_A_CALL", sameInstant),
      lead("ck02", "WORTH_A_CALL", sameInstant),
    ];

    expect(ids(orderForCalling(batch))).toEqual(["ck01", "ck02", "ck03"]);
    expect(ids(orderForCalling([...batch].reverse()))).toEqual([
      "ck01",
      "ck02",
      "ck03",
    ]);
  });

  it("leaves the caller's array alone — it is a render input, not scratch space", () => {
    const input = [
      lead("thin", "THIN", "2026-10-05T00:00:00.000Z"),
      lead("strong", "STRONG", "2026-10-01T00:00:00.000Z"),
    ];
    orderForCalling(input);
    expect(ids(input)).toEqual(["thin", "strong"]);
  });
});

describe("the bands the list is cut into", () => {
  it("emits one group per band present, in the order the leads are read", () => {
    const groups = groupForCalling([
      lead("t1", "THIN", "2026-10-02T00:00:00.000Z"),
      lead("s1", "STRONG", "2026-10-01T00:00:00.000Z"),
      lead("t2", "THIN", "2026-10-03T00:00:00.000Z"),
      lead("s2", "STRONG", "2026-10-04T00:00:00.000Z"),
    ]);

    /* Two groups, not four. Cut by ADJACENCY in the sorted list, so a
       comparator that stopped ordering would interleave the bands and fragment
       these groups rather than quietly keeping tidy headings. */
    expect(groups.map((g) => g.band)).toEqual(["STRONG", "THIN"]);
    expect(groups.map((g) => ids(g.leads))).toEqual([
      ["s2", "s1"],
      ["t2", "t1"],
    ]);
  });

  it("gives a band with no leads no group at all", () => {
    const groups = groupForCalling([
      lead("w", "WORTH_A_CALL", "2026-10-01T00:00:00.000Z"),
    ]);
    expect(groups.map((g) => g.band)).toEqual(["WORTH_A_CALL"]);
  });

  it("keeps every lead exactly once", () => {
    const input = FIT_BANDS.flatMap((band, i) => [
      lead(`${band}-a`, band, `2026-10-0${i + 1}T00:00:00.000Z`),
      lead(`${band}-b`, band, `2026-10-0${i + 1}T00:00:00.000Z`),
    ]);
    const flattened = groupForCalling(input).flatMap((g) => ids(g.leads));
    expect(flattened.slice().sort()).toEqual(ids(input).slice().sort());
    expect(flattened).toHaveLength(input.length);
  });
});

/* ───────────────────────── and now on a screen ───────────────────────── */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function render(leads: readonly Row[]) {
  act(() => {
    root.render(createElement(SalesLeadList, { leads }));
  });
}

const headings = () =>
  Array.from(container.querySelectorAll("h2")).map((h) =>
    (h.textContent ?? "").replace(/\s+/g, " ").trim(),
  );

describe("what the list actually renders", () => {
  const mixed = [
    lead("thin-new", "THIN", "2026-10-05T00:00:00.000Z"),
    lead("worth", "WORTH_A_CALL", "2026-10-03T00:00:00.000Z"),
    lead("strong-old", "STRONG", "2026-10-01T00:00:00.000Z"),
    lead("thin-old", "THIN", "2026-09-01T00:00:00.000Z"),
  ];

  it("puts the rows on the page in the calling order, not the order it was handed", () => {
    render(mixed);

    /* Read off the DOM, which is the thing a person sees — a comparator that
       sorts correctly into a list nobody renders in that order is the gap this
       half of the file exists for. */
    const onScreen = Array.from(container.querySelectorAll("li")).map((li) =>
      (li.textContent ?? "").split(" Drywall")[0],
    );
    expect(onScreen).toEqual([
      "strong-old",
      "worth",
      "thin-new",
      "thin-old",
    ]);
  });

  it("names each band and counts it, so the order is not silent", () => {
    render(mixed);
    expect(headings()).toEqual([
      `${BAND_LABELS.STRONG} 1 lead`,
      `${BAND_LABELS.WORTH_A_CALL} 1 lead`,
      `${BAND_LABELS.THIN} 2 leads`,
    ]);
  });

  it("writes no heading for a band nothing is in", () => {
    /**
     * NOT TIDINESS — `e2e/specs/sales-crm.spec.ts` step 3 asserts that the
     * strongest band's label appears on `/sales` ZERO times while no lead has
     * earned it, which is the anchor making its later confirm assertions mean
     * anything. A heading reading "Call this one — 0 leads" would break that
     * spec in CI and, worse, would put the sentence this screen exists to say
     * in front of somebody on a morning when it is not true.
     */
    render([
      lead("w", "WORTH_A_CALL", "2026-10-01T00:00:00.000Z"),
      lead("t", "THIN", "2026-10-01T00:00:00.000Z"),
    ]);

    const text = container.textContent ?? "";
    expect(text).not.toContain(BAND_LABELS.STRONG);
    expect(text).not.toContain(BAND_LABELS.NOT_A_FIT);
    expect(headings()).toHaveLength(2);
  });

  it("renders one flat li per lead, because the browser spec counts them", () => {
    /* `page.locator("li").filter({ hasText: <lead name> })` is asserted to
       resolve to exactly ONE element. Nesting the rows inside a group <li>
       would make it two, and a <ul> may hold nothing but <li> anyway — invalid
       nesting is rewritten by the parser, which is a guaranteed hydration
       mismatch (CLAUDE.md's #418 entry). */
    render(mixed);
    const items = Array.from(container.querySelectorAll("li"));
    expect(items).toHaveLength(mixed.length);
    for (const li of items) {
      expect(li.querySelector("li")).toBeNull();
      expect(li.parentElement?.tagName).toBe("UL");
    }
  });

  it("gives the heading the band's word, not only its colour", () => {
    /* CLAUDE.md: a status is a word and a colour, never a colour. And the word
       is never alone in its own element, so a locator for the bare label still
       resolves to row pills only. */
    render([lead("s", "STRONG", "2026-10-01T00:00:00.000Z")]);
    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toContain(BAND_LABELS.STRONG);
    expect(h2?.className).toMatch(/bg-tag-/);
    expect(
      Array.from(container.querySelectorAll("h2 *")).map((e) => e.textContent),
    ).not.toContain(BAND_LABELS.STRONG);
  });
});
