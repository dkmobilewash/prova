import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The three add-forms that refuse, and what they offer instead.
 *
 * A form that cannot be used until something else exists is the first thing
 * a brand-new contractor meets on `/punch-lists` and `/field-reports`, and
 * both refused with a bare sentence — "Create a job first" — leaving the one
 * available next step as something to go and find in the nav. `/photos`
 * handles the identical case with a real link, and is the pattern.
 *
 * Rendered rather than grepped, for the reason `EquipmentRow.test.ts` gives:
 * these branches are output, and a link inside a branch that never runs
 * greps exactly like one that does.
 */

// These forms import the actions barrel only to post to it. Importing it for
// real drags Prisma and Clerk into a suite whose point is needing neither.
vi.mock("@/lib/actions", () => ({
  createPunchListItem: vi.fn(),
  settleAskDraft: vi.fn(),
  createDailyFieldReport: vi.fn(),
}));
// ReceivablesList reads the router at the top of its body, and there is no
// app-router context in a bare render.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const { PunchListForm } = await import("@/components/PunchListForm");
const { FieldReportComposer } = await import("@/components/FieldReportComposer");
const { ReceivablesList, ReceivablesProvider } = await import("@/components/ReceivablesPanel");

describe("PunchListForm with no jobs", () => {
  const html = renderToStaticMarkup(createElement(PunchListForm, { jobs: [] }));

  it("still explains why it cannot be used", () => {
    expect(html).toContain("attach to a job");
  });

  it("offers the way out, which it previously only described", () => {
    expect(html).toContain('href="/jobs/new"');
    expect(html).toContain("Create a job");
  });

  it("no longer tells the reader to go and do it themselves", () => {
    expect(html).not.toContain("Create a job first");
  });
});

describe("FieldReportComposer with no jobs", () => {
  const html = renderToStaticMarkup(createElement(FieldReportComposer, { jobs: [] }));

  it("still explains why it cannot be used", () => {
    expect(html).toContain("A field report records what happened on a job");
  });

  it("offers the way out", () => {
    expect(html).toContain('href="/jobs/new"');
    expect(html).toContain("Create a job");
  });
});

describe("ReceivablesList with an empty list", () => {
  function render(invoicesRaised: number) {
    return renderToStaticMarkup(
      // The rule is about JSX, where children belong between the tags. The
      // unit suite only collects `*.test.ts`, so there is no JSX available
      // here — and createElement's variadic children do not satisfy a props
      // type that declares `children` as required, which is what the
      // provider does.
      // eslint-disable-next-line react/no-children-prop
      createElement(ReceivablesProvider, {
        rows: [],
        invoicesRaised,
        children: createElement(ReceivablesList),
      }),
    );
  }

  it("does not congratulate an account that has raised no invoices", () => {
    const html = render(0);
    expect(html).toContain("No invoices raised yet");
    // True, and absurd to read on your first morning.
    expect(html).not.toContain("has been paid in full");
  });

  it("keeps the paid-in-full sentence when invoices DO exist and are all paid", () => {
    // The case the old sentence was written for, and it is still right. An
    // empty list has two causes and they need opposite sentences; the list
    // alone cannot tell them apart, which is why the count is passed in.
    const html = render(4);
    expect(html).toContain("Every invoice raised has been paid in full");
    expect(html).not.toContain("No invoices raised yet");
  });
});
