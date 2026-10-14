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

function paint() {
  act(() =>
    root.render(
      createElement(BidPackageBuilder, { projectName: "West Herr Jaguar", today: "2026-10-14" }),
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

  it("renders the builder, with the project and the viewer's own date", () => {
    expect(source).toMatch(/<BidPackageBuilder\s/);
    expect(source).toMatch(/projectName=\{job\.name\}/);
    expect(source).toMatch(/today=\{today\}/);
    // The date comes from the viewer's timezone cookie on the SERVER. A
    // `localToday()` in the component would be a hydration mismatch for a file
    // name, which is not a trade worth making.
    expect(source).toMatch(/const today = await viewerToday\(\);/);
  });

  it("is not part of the printed document", () => {
    // The package builder is a working surface. If it loses `print:hidden` it
    // ends up in the PDF a general contractor receives.
    const component = readFileSync(resolve(__dirname, "BidPackageBuilder.tsx"), "utf8");
    expect(component).toContain('className="print:hidden');
  });
});
