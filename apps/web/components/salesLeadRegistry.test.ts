// @vitest-environment happy-dom

/**
 * RENDERS THE PUBLIC-REGISTER CARD, BECAUSE A CENSUS CANNOT TELL YOU A
 * COMPONENT SHOWS ANYTHING.
 *
 * `lib/sales-registry.test.ts` proves the sentences and the rows are right.
 * Nothing in it can prove that `SalesLeadRegistry.tsx` puts them on a screen —
 * and this repo has paid for exactly that gap twice. CLAUDE.md's expo-router
 * entry is the sharper version: three PRs asserted that a screen CONTAINED a
 * header option and the framework threw it away, all three green. *"A census
 * can tell you the code is THERE. It can never tell you a framework HONOURS
 * it."*
 *
 * So the mutation this file exists to kill is **make it render nothing**. Delete
 * the `<dl>`, drop the standing sentence, stop passing the licence through, and
 * this goes red naming what disappeared.
 *
 * Written with `createElement` rather than JSX because the suite collects
 * `.test.ts` as well as `.test.tsx` and every other render test here is a
 * `.test.ts` — same reason as `actionForm.test.ts` and `timeEntryRow.test.ts`.
 *
 * WHAT THIS CANNOT SEE, stated rather than left to be found out: size, position
 * and contrast. happy-dom does no layout and returns zeros from
 * `getBoundingClientRect` — the `SubListingImport` checkbox that rendered at
 * 13x13 was invisible to every test in this repo for the same reason. What is
 * checkable here is that the text is present, that the identifier carries the
 * tabular face, and that the standing is a WORD and not only a colour.
 */

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SalesLeadRegistry } from "@/components/SalesLeadRegistry";
import {
  CSLB_LICENCE_SEARCH_URL,
  lookupStanding,
  registerLookup,
  type LeadRegistry,
} from "@/lib/sales-registry";

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

const imported: LeadRegistry = {
  licenceNumber: "884201",
  registrationNumber: "1000012345",
  city: "Fontana, CA",
  listedByGc: "Swinerton Builders",
  listedOnProject: "Lincoln Elementary Modernization",
  phone: null,
};

function render(lead: LeadRegistry) {
  act(() => {
    root.render(createElement(SalesLeadRegistry, { lead }));
  });
  return {
    text: () => container.textContent ?? "",
    labels: () => [...container.querySelectorAll("dt")].map((dt) => dt.textContent),
    values: () => [...container.querySelectorAll("dd")].map((dd) => dd.textContent),
    valueEl: (label: string) => {
      const dt = [...container.querySelectorAll("dt")].find((el) => el.textContent === label);
      return dt?.nextElementSibling ?? null;
    },
    /** Every anchor actually in the DOM, with its href — not a mock's record. */
    links: () =>
      [...container.querySelectorAll("a")].map((a) => ({
        href: a.getAttribute("href") ?? "",
        text: (a.textContent ?? "").trim(),
        className: a.className,
      })),
  };
}

describe("the imported lead — no phone number, a licence", () => {
  it("renders every column the listing filled, labelled", () => {
    const card = render(imported);
    expect(card.labels()).toEqual([
      "CSLB licence",
      "DIR registration",
      "City",
      "Listed by",
      "Listed on",
    ]);
    expect(card.values()).toEqual([
      "884201",
      "1000012345",
      "Fontana, CA",
      "Swinerton Builders",
      "Lincoln Elementary Modernization",
    ]);
  });

  /**
   * The licence is not just present, it is present WITH THE REASON IT MATTERS.
   * A number under a bare heading is a fact nobody acts on; the sentence is what
   * makes it the next step. Asserted against the module's own answer rather than
   * a copy of the wording, so a reworded sentence does not fail this and a
   * DROPPED one does.
   */
  it("says what the licence is a key to, not merely what it is", () => {
    const card = render(imported);
    expect(card.text()).toContain(lookupStanding(imported).sentence);
    expect(card.text()).toContain("884201");
  });

  /** A status is a word and a colour, never a colour alone. */
  it("names the standing in words", () => {
    expect(render(imported).text()).toContain("Licence to look up");
    expect(render({ ...imported, phone: "(909) 555-0134" }).text()).toContain("Has a number");
    expect(render({ ...imported, licenceNumber: null }).text()).toContain(
      "No way to reach them",
    );
  });

  /**
   * The two identifiers get the tabular face and the prose does not — an
   * identifier is read out digit by digit down a telephone. This is the one thing
   * here that is about appearance, and it is checkable because it is a class on a
   * specific element rather than a measured size.
   */
  it("sets the identifiers in a tabular face and leaves the prose alone", () => {
    const card = render(imported);
    expect(card.valueEl("CSLB licence")?.className).toContain("tabular-nums");
    expect(card.valueEl("DIR registration")?.className).toContain("tabular-nums");
    expect(card.valueEl("Listed on")?.className ?? "").not.toContain("tabular-nums");
  });
});

describe("the hand-typed lead — nothing on the register", () => {
  const bare: LeadRegistry = {
    licenceNumber: null,
    registrationNumber: null,
    city: null,
    listedByGc: null,
    listedOnProject: null,
    phone: null,
  };

  it("renders no rows at all rather than five saying nothing", () => {
    const card = render(bare);
    expect(card.labels()).toEqual([]);
    expect(container.querySelector("dl")).toBeNull();
  });

  it("says what would fill the card, so it does not read as broken", () => {
    const card = render(bare);
    expect(card.text()).toContain("Nothing on the register yet");
    expect(card.text()).toMatch(/subcontractor listing/);
  });
});

/**
 * THE LINKS, AND THE MUTATION THAT HAS TO KILL THIS BLOCK.
 *
 * `lib/sales-registry.test.ts` proves the URL and the wording. Nothing in it can
 * prove an `<a>` reaches the DOM — and CLAUDE.md's expo-router entry is three
 * PRs' worth of exactly that: *"A census can tell you the code is THERE. It can
 * never tell you a framework HONOURS it."* So these read `querySelectorAll("a")`
 * on the rendered container. Delete the link block from the component and every
 * assertion below goes red naming what vanished.
 */
describe("the way out of the card — the links a person clicks", () => {
  it("renders a real anchor to CSLB's search, in the document", () => {
    const card = render(imported);
    const cslb = card.links().find((a) => a.href === CSLB_LICENCE_SEARCH_URL);
    expect(cslb, "no anchor in the DOM pointing at CSLB's licence search").toBeDefined();
    expect(cslb?.text).toBe(registerLookup(imported)?.linkLabel);
    expect(cslb?.href).toMatch(/^https:\/\/www\.cslb\.ca\.gov\//);
  });

  /**
   * The measured defect, asserted against the DOM rather than the module: a
   * `LicenseDetail.aspx?LicNum=` href 302s to the search page for anybody with no
   * CSLB session, which is every visitor from this app. Pinned here as well as in
   * the module test because this is the layer somebody "improves".
   */
  it("ships no LicenseDetail href anywhere on the card", () => {
    const hrefs = render(imported).links().map((a) => a.href);
    expect(hrefs.some((h) => /LicenseDetail|LicNum/i.test(h))).toBe(false);
  });

  /** The number has to be ON SCREEN to be pasted — an href cannot be copied. */
  it("shows the instruction and the number beside the link", () => {
    const card = render(imported);
    expect(card.text()).toContain(registerLookup(imported)?.instruction);
    expect(card.text()).toMatch(/paste/i);
    expect(card.text()).toContain("884201");
  });

  /** A new tab, so a half-written lead edit is not navigated away from. */
  it("opens CSLB in a new tab with no referrer", () => {
    render(imported);
    const a = [...container.querySelectorAll("a")].find(
      (el) => el.getAttribute("href") === CSLB_LICENCE_SEARCH_URL,
    );
    expect(a, "no anchor in the DOM pointing at CSLB's licence search").toBeTruthy();
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noreferrer");
  });

  /**
   * Tokens, not shadcn semantic names. `text-link`/`text-link-hover` are this
   * app's own (`apps/web/tailwind.config.ts`); `text-primary` resolves to nothing
   * here and renders unstyled.
   */
  it("uses this app's link tokens and no shadcn semantic names", () => {
    const classes = render(imported).links().map((a) => a.className).join(" ");
    expect(classes).toMatch(/\btext-link\b/);
    expect(classes).not.toMatch(/text-primary|bg-primary|text-primary-foreground/);
  });

  /** No licence, no link — not a dead control. */
  it("renders no CSLB link when there is no licence to look up", () => {
    const card = render({ ...imported, licenceNumber: null });
    expect(card.links().some((a) => /cslb\.ca\.gov/i.test(a.href))).toBe(false);
    expect(card.text()).not.toMatch(/paste/i);
  });
});

describe("the phone, when a person has typed one in", () => {
  const callable: LeadRegistry = { ...imported, phone: "(909) 555-0134 ext 2" };

  it("renders a tel: anchor whose digits exclude the extension", () => {
    const tel = render(callable).links().find((a) => a.href.startsWith("tel:"));
    expect(tel, "no tel: anchor in the DOM").toBeDefined();
    expect(tel?.href).toBe("tel:90955501342");
  });

  /**
   * The text stays what somebody typed. The href is stripped; the label is not,
   * because "(909) 555-0134 ext 2" is what reads back correctly to a human and
   * "90955501342" is not.
   */
  it("shows the number as it was typed, not as the href spells it", () => {
    const tel = render(callable).links().find((a) => a.href.startsWith("tel:"));
    expect(tel?.text).toBe("(909) 555-0134 ext 2");
  });

  /**
   * THE STATE EVERY IMPORTED LEAD IS IN. `importSubListing` never writes `phone`
   * — a §4104 listing has no telephone column — so only the hand-typed lead form
   * fills it. A card that rendered a `tel:` link here would be offering to ring a
   * number nobody has.
   */
  it("renders no tel: link at all when no number is on file", () => {
    expect(render(imported).links().some((a) => a.href.startsWith("tel:"))).toBe(false);
    expect(render({ ...imported, phone: "call the office" }).links().some((a) =>
      a.href.startsWith("tel:"),
    )).toBe(false);
  });
});
