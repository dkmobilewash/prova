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
import { lookupStanding, type LeadRegistry } from "@/lib/sales-registry";

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
