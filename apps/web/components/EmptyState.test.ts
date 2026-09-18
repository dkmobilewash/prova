import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The shared empty state, rendered rather than read.
 *
 * What matters about it is output — which buttons exist, which one is the
 * primary, whether the example is unmistakably an example — and a branch
 * greps exactly the same whether or not it runs (EquipmentRow.test.ts).
 */

// The walkthrough button asks which page it is on; the Ask button holds a
// router for its fallback. Neither exists in a bare server render.
let pathname = "/contacts";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}));

const { EmptyState } = await import("@/components/EmptyState");

type Props = Parameters<typeof EmptyState>[0];

function render(props: Partial<Props> & Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(EmptyState, {
      title: "No contacts yet",
      purpose: createElement("p", null, "Your client list."),
      ...props,
    } as Props),
  );
}

describe("the words", () => {
  it("says what is missing and what the page is for", () => {
    const html = render();
    expect(html).toContain("No contacts yet");
    expect(html).toContain("Your client list.");
  });

  it("passes a walkthrough anchor straight through to the root", () => {
    const html = render({ "data-tour": "contacts-empty" });
    expect(html).toMatch(/^<section[^>]*data-tour="contacts-empty"/);
  });
});

describe("the actions", () => {
  it("draws the FIRST action as the primary and the rest as secondary", () => {
    const html = render({
      actions: [
        { label: "Add a contact", opens: "contacts-add" },
        { label: "Import from a spreadsheet", href: "/settings/import" },
      ],
    });
    const add = html.match(/<button[^>]*data-opens="contacts-add"[^>]*>/)?.[0] ?? "";
    const importLink = html.match(/<a[^>]*href="\/settings\/import"[^>]*>/)?.[0] ?? "";
    expect(add, "the add button was not rendered").not.toBe("");
    expect(importLink, "the import link was not rendered").not.toBe("");
    expect(add).toContain("bg-brand");
    expect(importLink).not.toContain("bg-brand");
    expect(importLink).toContain("border-line-card");
  });

  it("a link action is a real link to the page, not a button", () => {
    const html = render({ actions: [{ label: "Create a job", href: "/jobs/new" }] });
    expect(html).toMatch(/<a[^>]*href="\/jobs\/new"[^>]*>Create a job<\/a>/);
  });

  it("never puts white text on the brand yellow", () => {
    const html = render({ actions: [{ label: "Create a job", href: "/jobs/new" }] });
    const brand = [...html.matchAll(/class="([^"]*\bbg-brand\b[^"]*)"/g)].map((m) => m[1]);
    expect(brand.length).toBeGreaterThan(0);
    for (const cls of brand) {
      expect(cls).toContain("text-neutral-900");
      expect(cls).not.toMatch(/\btext-white\b/);
    }
  });

  it("refuses a fourth action — four equal buttons is a menu, not a next step", () => {
    const four = ["a", "b", "c", "d"].map((label) => ({ label, href: `/${label}` }));
    expect(() => render({ actions: four })).toThrow(/at most 3 actions/);
  });

  it("offers the assistant only when given a sentence, and shows the sentence", () => {
    expect(render()).not.toContain("Ask C Stream to do it");
    const html = render({ ask: "Add Jane Smith as a contact" });
    expect(html).toContain("Ask C Stream to do it");
    expect(html).toContain("“Add Jane Smith as a contact”");
    expect(html).toContain("before anything is saved");
  });
});

describe("Walk me through this page", () => {
  it("appears on a page that has a walkthrough", () => {
    pathname = "/contacts";
    expect(render()).toContain("Walk me through this page");
  });

  it("never appears as a dead button on a page without one", () => {
    pathname = "/no-such-page";
    try {
      expect(render()).not.toContain("Walk me through this page");
    } finally {
      pathname = "/contacts";
    }
  });

  it("can be switched off", () => {
    expect(render({ walkthrough: false })).not.toContain("Walk me through this page");
  });
});

describe("the example", () => {
  const rows = [
    { title: "Jane Smith", tag: "Active", detail: "jane@example.com", meta: "2 jobs" },
    { title: "Northside Builders", detail: "(555) 010-2030" },
  ];
  const html = render({ example: { rows } });
  const figure = html.match(/<figure[\s\S]*<\/figure>/)?.[0] ?? "";

  it("renders, with every row", () => {
    expect(figure, "no example was rendered").not.toBe("");
    for (const row of rows) expect(figure).toContain(row.title);
    expect(figure).toContain("jane@example.com");
    expect(figure).toContain("2 jobs");
  });

  it("is labelled Example and says it is not their data", () => {
    expect(figure).toMatch(/>Example</);
    expect(figure).toContain("Not your data");
  });

  it("cannot be clicked, tabbed into or read out as records", () => {
    const list = figure.match(/<ul[^>]*>/)?.[0] ?? "";
    expect(list).toContain('aria-hidden="true"');
    expect(list).toMatch(/\binert=""/);
    expect(list).toContain("border-dashed");
    expect(list).toContain("opacity-60");
    expect(figure).not.toMatch(/<a\b|<button\b|<input\b/);
  });

  it("is absent when a page gives none", () => {
    expect(render()).not.toContain("<figure");
    expect(render({ example: { rows: [] } })).not.toContain("<figure");
  });
});

describe("where records come from", () => {
  it("is shown under its own heading when given", () => {
    const html = render({ sources: createElement("p", null, "Every job's client.") });
    expect(html).toContain("Where these come from");
    expect(html).toContain("Every job&#x27;s client.");
  });

  it("is absent when not", () => {
    expect(render()).not.toContain("Where these come from");
  });
});
