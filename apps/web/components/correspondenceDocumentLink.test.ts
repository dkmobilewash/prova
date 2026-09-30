// @vitest-environment happy-dom

/**
 * THE TWO RECORDS THAT COME BACK FROM THE GC CAN SAY WHERE THEIR PAPER LIVES.
 *
 * WHAT WAS MISSING. `recordSubmittalResponse` stored the outcome the stamp
 * said and the reviewer's notes, and had nowhere to point at the stamp
 * itself. `answerRfi` stored the answer somebody typed, and had nowhere to
 * point at the letter it was typed from. Both are the document an argument
 * is had over when a crew is told it built the wrong thing, and both lived
 * only in somebody's inbox.
 *
 * WHY THIS TEST EXISTS RATHER THAN A TEST OF THE ACTION. Four nullable
 * columns and two `optionalLinkOrThrow` calls are the easy half, and a
 * column that nothing renders is this repo's "written, documented, and never
 * called" shape wearing a migration — the whole point is that a person can
 * SEE the link. So the assertions here are read off the rendered DOM, and
 * every query throws when it finds nothing: a test that silently matched no
 * anchor would pass on a row that had stopped rendering the link at all.
 *
 * THE THIRD CASE IS THE ONE THAT KEEPS IT HONEST. Null must render NOTHING.
 * Recording an outcome or an answer with no paper attached is the ordinary
 * case and worked before these columns existed; a row that grew an empty
 * "the stamped submittal" link, or a dangling separator, would be this
 * change making the common path worse to serve the rare one.
 *
 * NOT ASSERTED HERE, because another file already owns it:
 * `linkValidationCensus.test.ts` is what proves both actions run these values
 * through the one shared validator before they can reach an `href`. It
 * covered `responseUrl` and `answerUrl` the moment they existed, with no edit
 * to the census — mutation-checked by reverting the submittal action to a
 * bare `text()` read and watching it name the field.
 *
 * createElement rather than JSX because the suite's `include` matches
 * .test.ts and not .test.tsx — same reason as sentDateDefault.test.ts.
 */

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const noop = vi.fn(async () => ({ ok: true as const }));

vi.mock("@/lib/actions", () => ({
  createRfi: noop,
  settleAskDraft: noop,
  createSubmittal: noop,
  updateRfi: noop,
  deleteRfi: noop,
  answerRfi: noop,
  markRfiSent: noop,
  setRfiClosed: noop,
  updateSubmittal: noop,
  deleteSubmittal: noop,
  recordSubmittalResponse: noop,
  sendSubmittalRevision: noop,
}));

const { RfiRow } = await import("@/components/RfiRow");
const { SubmittalRow } = await import("@/components/SubmittalRow");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: Parameters<Root["render"]>[0]) {
  act(() => root.render(node));
}

/** The one anchor whose href is the link under test. Throws rather than
 * returning null, so a row that stopped rendering it fails here. */
function linkTo(href: string): HTMLAnchorElement {
  const found = [...container.querySelectorAll("a")].find((a) => a.getAttribute("href") === href);
  if (!found) {
    throw new Error(
      `no anchor with href ${href}. Anchors present: ${[...container.querySelectorAll("a")]
        .map((a) => `${a.getAttribute("href")} (${a.textContent})`)
        .join(", ") || "none"}`,
    );
  }
  return found as HTMLAnchorElement;
}

const answeredRfi = {
  id: "rfi-1",
  number: 14,
  jobName: "Riverside",
  subject: "Head of wall at grid 4",
  question: "Which detail governs?",
  drawingReference: "A-501",
  specSection: "09 21 16",
  status: "ANSWERED",
  sentOn: "2026-09-08",
  dueBy: "2026-09-15",
  answeredOn: "2026-09-11",
  answer: "Use detail 4/A-501.",
  answerUrl: null as string | null,
  answerFileName: null as string | null,
  costImpact: false,
  scheduleImpact: false,
  askedByName: "Tester",
};

const returnedSubmittal = {
  id: "sub-1",
  number: 8,
  jobName: "Riverside",
  title: "Track and stud data",
  description: null,
  specSection: "09 22 16",
  drawingReference: null,
  submittedByName: "Tester",
  revisions: [
    {
      revisionNumber: 2,
      sentOn: "2026-09-01",
      dueBack: "2026-09-08",
      returnedOn: "2026-09-05",
      outcome: "APPROVED_AS_NOTED",
      responseNotes: "Gauge on the head track to be 20ga.",
      responseUrl: null as string | null,
      responseFileName: null as string | null,
    },
  ],
};

describe("an RFI's answer can point at the GC's own letter", () => {
  it("renders the link under the answer, labelled the way it was named", () => {
    render(
      createElement(RfiRow, {
        rfi: {
          ...answeredRfi,
          answerUrl: "https://gc.example.com/rfi-14-response.pdf",
          answerFileName: "RFI 014 response.pdf",
        },
        today: "2026-09-21",
        canDelete: false,
        showJob: false,
      }),
    );
    const link = linkTo("https://gc.example.com/rfi-14-response.pdf");
    expect(link.textContent).toBe("RFI 014 response.pdf");
    // It leaves the app, so it opens away from the page the person is working
    // on and carries no referrer to the GC's system.
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("falls back to words rather than showing a bare URL when no label was given", () => {
    render(
      createElement(RfiRow, {
        rfi: { ...answeredRfi, answerUrl: "https://gc.example.com/x.pdf", answerFileName: null },
        today: "2026-09-21",
        canDelete: false,
        showJob: false,
      }),
    );
    expect(linkTo("https://gc.example.com/x.pdf").textContent).toBe("the GC's written answer");
  });

  it("renders NO link at all when there is no document, which is the ordinary case", () => {
    render(
      createElement(RfiRow, {
        rfi: answeredRfi,
        today: "2026-09-21",
        canDelete: false,
        showJob: false,
      }),
    );
    // The answer itself is still there — this asserts the absence of the link,
    // not the absence of the row.
    expect(container.textContent).toContain("Use detail 4/A-501.");
    expect(container.textContent).not.toContain("the GC's written answer");
  });
});

describe("a submittal revision can point at the stamp it records", () => {
  it("renders the link beside the outcome, labelled the way it was named", () => {
    render(
      createElement(SubmittalRow, {
        submittal: {
          ...returnedSubmittal,
          revisions: [
            {
              ...returnedSubmittal.revisions[0],
              responseUrl: "https://gc.example.com/stamped-rev2.pdf",
              responseFileName: "Stamped 09 22 16 Rev 2.pdf",
            },
          ],
        },
        today: "2026-09-21",
        canDelete: false,
        showJob: false,
      }),
    );
    const link = linkTo("https://gc.example.com/stamped-rev2.pdf");
    expect(link.textContent).toBe("Stamped 09 22 16 Rev 2.pdf");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    // The outcome and the notes are untouched by the addition.
    expect(container.textContent).toContain("Gauge on the head track to be 20ga.");
  });

  it("falls back to words rather than a bare URL when no label was given", () => {
    render(
      createElement(SubmittalRow, {
        submittal: {
          ...returnedSubmittal,
          revisions: [
            {
              ...returnedSubmittal.revisions[0],
              responseUrl: "https://gc.example.com/y.pdf",
              responseFileName: null,
            },
          ],
        },
        today: "2026-09-21",
        canDelete: false,
        showJob: false,
      }),
    );
    expect(linkTo("https://gc.example.com/y.pdf").textContent).toBe("the stamped submittal");
  });

  it("renders NO link and no dangling separator when there is no document", () => {
    render(
      createElement(SubmittalRow, {
        submittal: returnedSubmittal,
        today: "2026-09-21",
        canDelete: false,
        showJob: false,
      }),
    );
    expect(container.textContent).toContain("Gauge on the head track to be 20ga.");
    expect(container.textContent).not.toContain("the stamped submittal");
  });
});
