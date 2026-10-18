// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BidPackageBuilder } from "./BidPackageBuilder";
import { PACKAGE_SLOTS, PACKAGE_SLOT_LABEL } from "@/lib/estimating/bid-package";

/**
 * THE BID PACKAGE CONTROL IS ON THE SCREEN AND CAN BE REACHED.
 *
 * `bid-package.test.ts` proves the merge against real PDFs. It says nothing
 * about anybody being able to press it, which is the #665 lesson this repo has
 * paid for twice in one sitting — a control that existed, called the right
 * action and appeared on no screen, and three expo-router fixes that shipped
 * green and rendered nothing. A census proves the code is there; only rendering
 * proves somebody can reach it.
 *
 * WHAT THIS CANNOT TEST, stated so nobody reads the green as more than it is:
 * the merge itself needs a real `File` and `URL.createObjectURL`, and happy-dom
 * has no layout, so neither the download nor where any control SITS is checked
 * here. `bid-package.test.ts` covers the bytes; the click-list covers the
 * screen.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

const TARGET = {
  bidInvitationId: "bid_1",
  companyId: "co_1",
  companyName: "Cyrus Drywall",
  gcName: "Turner Construction",
  addresses: [
    { address: "dana@turner.com", name: "Dana Reyes" },
    { address: "bids@turner.com", name: "Turner Construction" },
  ],
  problem: null,
  findings: [] as { id: string; title: string; href: string | null }[],
};

function paint(submit?: Partial<typeof TARGET>) {
  act(() =>
    root.render(
      createElement(BidPackageBuilder, {
        projectName: "West Herr Jaguar",
        ...(submit ? { submit: { ...TARGET, ...submit } } : {}),
      }),
    ),
  );
  return {
    build: host.querySelector<HTMLButtonElement>('button[data-package="build"]')!,
    inputs: [...host.querySelectorAll<HTMLInputElement>("input[data-package-slot]")],
  };
}

describe("the control renders and offers every slot", () => {
  it("has a Build button", () => {
    expect(paint().build).not.toBeNull();
  });

  it("offers a file input for every slot, in package order", () => {
    const { inputs } = paint();
    expect(inputs.map((input) => input.dataset.packageSlot)).toEqual([...PACKAGE_SLOTS]);
  });

  it("names each slot and says what belongs in it", () => {
    paint();
    for (const slot of PACKAGE_SLOTS) {
      expect(host.textContent).toContain(PACKAGE_SLOT_LABEL[slot].label);
      expect(host.textContent).toContain(PACKAGE_SLOT_LABEL[slot].covers);
    }
  });

  it("takes PDFs only, and several per slot", () => {
    for (const input of paint().inputs) {
      expect(input.accept).toBe("application/pdf");
      expect(input.multiple).toBe(true);
    }
  });

  it("labels every input for a screen reader", () => {
    for (const input of paint().inputs) {
      expect(input.getAttribute("aria-label")?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("REFUSES TO BUILD WITH NOTHING CHOSEN", () => {
    // Pressing it with no files would hand `planPackage` an empty list, which
    // produces no bytes — a disabled button says so before the press instead of
    // after it.
    expect(paint().build.disabled).toBe(true);
  });

  it("says the files do not leave the computer", () => {
    // The reason the merge is local at all. If this sentence goes, somebody has
    // probably moved the merge to a server, which is the decision this whole
    // design turns on.
    paint();
    expect(host.textContent).toMatch(/nothing is uploaded/i);
  });
});

describe("and the proposal page actually mounts it", () => {
  /**
   * The render test above proves the control works GIVEN something renders it.
   * The same gap the sheet picker's census was written for, and the same
   * mutation got past that one: mounted, correct, and never reached.
   *
   * Comments stripped first — this page's own prose quotes the control's
   * purpose, and CLAUDE.md names the trap twice: the better the comment, the
   * more likely it contains the string you are forbidding.
   */
  const source = (() => {
    const raw = readFileSync(
      resolve(__dirname, "../app/(app)/jobs/[id]/proposal/page.tsx"),
      "utf8",
    );
    return raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  })();

  it("PARSED SOMETHING — so a broken strip fails loudly instead of passing", () => {
    expect(source.length).toBeGreaterThan(5_000);
    expect(source).toContain("export default async function JobProposalPage");
  });

  it("renders the builder, with the project it belongs to", () => {
    expect(source).toMatch(/<BidPackageBuilder\s/);
    expect(source).toMatch(/projectName=\{job\.name\}/);
  });

  it("DOES NOT hand it a date rendered on the server", () => {
    // ── WHY THIS IS ASSERTED AS AN ABSENCE ──
    //
    // The first version passed `today` down from `viewerToday()`. That was
    // safe for hydration and useless for the defect: every package built from
    // one page load shared a stamp, so two builds of one bid collided in
    // Downloads — found by clicking production. The clock is read inside the
    // press now, and a prop reappearing here is the regression.
    expect(source).not.toMatch(/today=\{/);
    expect(source).not.toMatch(/viewerToday\(\)/);
  });

  it("READS THE CLOCK AT THE PRESS, not once when the page opens", () => {
    // ── A MUTATION GOT PAST EVERYTHING ELSE HERE, WHICH IS WHY THIS EXISTS ──
    //
    // Hoisting the stamp to `useState(() => packageStamp(new Date()))` compiles
    // cleanly, renders identically, and restores the exact defect a production
    // click-through found: every package built from one page load shares a name,
    // so two builds of one bid collide in Downloads under a `(1)` nobody reads.
    // Every test in this file stayed green under it, because happy-dom cannot
    // run the build at all — no `File`, no `URL.createObjectURL`.
    //
    // So this is a SOURCE assertion, deliberately, and it is an honest one here
    // in a way it usually is not: the defect is WHERE THE CALL SITS, which is
    // the one thing reading the source can actually see. It would be dishonest
    // if it stood in for behaviour; it is not standing in for anything, because
    // nothing in this environment can press the button.
    const component = readFileSync(resolve(__dirname, "BidPackageBuilder.tsx"), "utf8");
    const code = component
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    // Called at the point of use, with a fresh Date.
    expect(code).toMatch(/packageFileName\(projectName, packageStamp\(new Date\(\)\)\)/);
    // And nowhere else: a stamp held in state or a module constant is the
    // regression, whatever it is named.
    expect(code.match(/packageStamp\(/g) ?? []).toHaveLength(1);
    expect(code).not.toMatch(/useState\([^)]*packageStamp/);
  });

  it("is not part of the printed document", () => {
    // The package builder is a working surface. If it loses `print:hidden` it
    // ends up in the PDF a general contractor receives.
    const component = readFileSync(resolve(__dirname, "BidPackageBuilder.tsx"), "utf8");
    expect(component).toContain('className="print:hidden');
  });
});

describe("sending it to the GC", () => {
  /**
   * ── WHAT THESE CAN AND CANNOT SEE ──
   *
   * The send panel only renders once a package has been BUILT, and building
   * needs `File.arrayBuffer`, pdf-lib and `URL.createObjectURL` — none of
   * which happy-dom can run. So nothing below presses Send; the refusals and
   * the ordering are `action-capability-guards.test.ts` and
   * `messages.test.ts`'s business, and both execute the real action.
   *
   * What IS asserted here is the part no test elsewhere can reach: that the
   * control is absent when it must be, and that the sentence a person reads
   * before an unrecallable send says who it is going to.
   */

  it("SHOWS NO SEND CONTROL AT ALL when no bid is linked to this job", () => {
    // Most jobs have none: a `BidInvitation` is company-scoped and only a WON
    // one carries `wonJobId`. Assembling is useful on its own and was the
    // whole of this control before sending existed.
    paint();
    expect(host.textContent).not.toMatch(/send it to/i);
    expect(host.querySelector('[data-submit="send"]')).toBeNull();
  });

  it("shows no send control before anything has been built", () => {
    // The thing being sent is the file the person just downloaded and
    // checked — not a rebuild that might differ from it.
    paint({});
    expect(host.querySelector('[data-submit="send"]')).toBeNull();
  });
});

describe("the send panel's own source, since happy-dom cannot build a package", () => {
  const code = (() => {
    const raw = readFileSync(resolve(__dirname, "BidPackageBuilder.tsx"), "utf8");
    return raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  })();

  it("PARSED SOMETHING", () => {
    expect(code.length).toBeGreaterThan(4_000);
    expect(code).toContain("export function BidPackageBuilder");
  });

  it("NAMES THE GC IN THE CONFIRM, not just 'are you sure'", () => {
    // `PayApplications` asks this way before a credit note: the figure and the
    // party spelled out beside the tick. A bid reaching a GC cannot be
    // recalled by anybody.
    expect(code).toMatch(/name="confirmSend"/);
    expect(code).toMatch(/send this bid to \{submit\.gcName\}/);
    expect(code).toMatch(/cannot be unsent/i);
  });

  it("OFFERS ADDRESSES RATHER THAN A TEXT BOX", () => {
    // The address is never typed. A free-text recipient would make "who did we
    // send the bid to" a question about somebody's typing, on the one write in
    // this app nobody can undo.
    expect(code).toMatch(/<select\s+name="toAddress"/);
    expect(code).not.toMatch(/<input[^>]*name="toAddress"/);
  });

  it("uploads under the bid-package purpose and hands the action the URL", () => {
    expect(code).toMatch(/uploadDocumentFile\("bid-package", submit\.companyId, file\)/);
    expect(code).toMatch(/submitBidPackage\(submit\.bidInvitationId, uploaded\.fileUrl, form\)/);
  });

  it("READS THE FORM BEFORE THE FIRST AWAIT", () => {
    // React 19's rule, which `formActionCensus` enforces elsewhere: the
    // event's own FormData is gone by the time an upload resolves.
    const handler = code.slice(code.indexOf("function send("));
    const readsForm = handler.indexOf("new FormData(event.currentTarget)");
    const firstAwait = handler.indexOf("await ");
    expect(readsForm).toBeGreaterThan(-1);
    expect(readsForm).toBeLessThan(firstAwait);
  });

  it("attaches exactly what was built, not a rebuild", () => {
    expect(code).toMatch(/new File\(\[built\.bytes as BlobPart\], built\.fileName/);
  });
});
