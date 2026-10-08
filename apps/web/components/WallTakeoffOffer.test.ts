import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * `/wall-takeoff`'s content, rendered rather than read — and rendered in BOTH
 * states, because the closed state is the one that cannot be grepped for: a
 * branch greps identically whether or not it runs (`EquipmentRow.test.ts`).
 *
 * WHAT THIS ASSERTS THAT `lib/takeoff-offer.test.ts` CANNOT. That census
 * proves the promises exist in exactly one place and that this component
 * NAMES the lists. Naming is not rendering — "written, documented and never
 * called" is a shape CLAUDE.md records three live instances of, every one of
 * them green. So every deliverable title and every limit is checked against
 * the real markup, derived from the module rather than retyped: a fifth
 * deliverable is covered here the day it is added, and a `.map` that silently
 * rendered nothing fails.
 *
 * AND THE CLOSED STATE IS ASSERTED IN BOTH DIRECTIONS, the shape
 * `app/page.test.ts` uses for its redirect: a form that never renders and one
 * that always renders both "pass" a test that only looks one way. `open`
 * false must not produce the form, and `open` true must.
 *
 * It renders signed out with no Clerk mock and no request scope — the proof
 * `/pilot`'s test uses that the page makes no hidden auth call, rather than an
 * assertion that it does not.
 */

// next/image validates its loader config against the Next runtime, which a
// unit test does not carry. The wordmark only needs to land in markup.
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // `priority` is a next/image directive, not an <img> attribute; React
    // would warn about an unknown prop. Deleted rather than destructured into
    // an unused binding, which lint flags.
    const rest = { ...props };
    delete rest.priority;
    return createElement("img", rest);
  },
}));

/**
 * The Server Action the form posts to. Mocked because this test renders the
 * form and never submits it — and because importing the real module would
 * drag a `"use server"` boundary and the Prisma client into a suite that is
 * meant to run in a second.
 */
vi.mock("@/lib/actions/takeoffOffer", () => ({
  requestDrawingSetRead: vi.fn(async () => ({
    ok: true as const,
    value: { sendTo: "help@example.com" },
  })),
}));

const { WallTakeoffOffer } = await import("@/components/WallTakeoffOffer");
const { DELIVERABLES, DELIVERY, LIMITS, NEXT_STEPS, WHAT_IT_FEEDS } = await import(
  "@/lib/takeoff-offer",
);

/** The markup is HTML, so the module's own apostrophes and ampersands arrive
 *  entity-escaped. Compared on decoded text rather than on the raw string, so
 *  a copy change with a `&` in it does not read as a missing promise. */
function decode(html: string): string {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&mdash;/g, "—")
    .replace(/&#x2014;/g, "—");
}

const render = (props: { open: boolean; sendTo: string | null }) =>
  decode(renderToStaticMarkup(createElement(WallTakeoffOffer, props)));

const open = render({ open: true, sendTo: "help@example.com" });
const closed = render({ open: false, sendTo: null });

describe("the offer itself is on the page", () => {
  it("found something to assert against", () => {
    // The floor. Two empty strings satisfy every `toContain` below that is
    // looping over a list, and an empty list satisfies all of them.
    expect(DELIVERABLES.length).toBeGreaterThanOrEqual(4);
    expect(LIMITS.length).toBeGreaterThanOrEqual(4);
    expect(NEXT_STEPS.length).toBeGreaterThanOrEqual(3);
    expect(WHAT_IT_FEEDS.length).toBeGreaterThanOrEqual(3);
    expect(open.length).toBeGreaterThan(2_000);
    expect(closed.length).toBeGreaterThan(1_000);
  });

  it("renders every deliverable's title, body and the way to check it", () => {
    for (const deliverable of DELIVERABLES) {
      expect(open, deliverable.id).toContain(deliverable.title);
      expect(open, deliverable.id).toContain(deliverable.body);
      expect(open, `${deliverable.id} — the check line is the whole offer`).toContain(
        deliverable.check,
      );
    }
  });

  it("renders every limit, in the same type size as the promises", () => {
    for (const limit of LIMITS) expect(open).toContain(limit);
    // Not smaller than the bodies beside them, which is the point of the
    // section rather than a style note — a limit set in `text-sm` under
    // `text-base` promises is a disclaimer, and this page is not that.
    expect(open).not.toMatch(/text-sm[^"]*">\s*(?:<span[^>]*>)?We do not price/);
  });

  it("renders the three steps and what they can do with the read", () => {
    for (const step of NEXT_STEPS) {
      expect(open).toContain(step.title);
      expect(open).toContain(step.body);
    }
    expect(open).toContain(DELIVERY.shareable);
  });

  it("shows the wordmark rather than a text stand-in", () => {
    expect(open).toContain("/brand/cstream-wordmark.png");
  });

  it("keeps the offer readable when it is closed", () => {
    // The closed state replaces the FORM, not the page: somebody handed the
    // link still has to learn what was being offered.
    for (const deliverable of DELIVERABLES) expect(closed).toContain(deliverable.title);
    for (const limit of LIMITS) expect(closed).toContain(limit);
    for (const fed of WHAT_IT_FEEDS) expect(closed, fed.id).toContain(fed.handed);
  });
});

/**
 * WHERE IT GOES FROM THERE — the section that answers what any of the free
 * read is FOR.
 *
 * It had no coverage here at all when it landed: `lib/takeoff-offer.test.ts`
 * asserts the component NAMES `WHAT_IT_FEEDS` and `.map`s it, which is a grep
 * over source and not a render. The agent that built the section proved it by
 * rendering in a throwaway file and deleting it; this is that, kept.
 *
 * BOTH HALVES OF EVERY ENTRY, because the split is the honesty of the section.
 * `handed` is what the free read gives them and `feeds` is the work inside the
 * app it goes into — an entry rendering only `handed` would restate a
 * deliverable and quietly drop the claim that a person does the rest, which is
 * the one thing this section may not lose.
 */
describe("where the read goes from there", () => {
  it("renders both halves of every chain", () => {
    for (const fed of WHAT_IT_FEEDS) {
      expect(open, `${fed.id} — handed`).toContain(fed.handed);
      expect(open, `${fed.id} — feeds`).toContain(fed.feeds);
    }
  });

  it("sits between what you get back and what we will not do", () => {
    // POSITION IS THE ARGUMENT, not a layout preference, so it is asserted
    // rather than left to whoever edits the file next. The section answers the
    // question a contractor has the moment they have read what arrives — so it
    // follows the promises. And it must come BEFORE the limits, because the
    // limits are what stop it reading as a claim that the takeoff happens by
    // itself: a page that says where the read leads and only afterwards says
    // we do not measure walls has sold the second half before denying it.
    //
    // String indices, which a DOM-less render can see: CLAUDE.md is explicit
    // that no test in this repo can measure layout, and this is document order
    // rather than layout.
    const got = open.indexOf("What you get back");
    const feeds = open.indexOf("Where it goes from there");
    const limits = open.indexOf("What we will not do");
    expect(got, "the deliverables heading").toBeGreaterThan(-1);
    expect(feeds, "the chains heading").toBeGreaterThan(-1);
    expect(limits, "the limits heading").toBeGreaterThan(-1);
    expect(feeds).toBeGreaterThan(got);
    expect(feeds).toBeLessThan(limits);
    // And the entries themselves are inside that window, not merely the
    // heading — a heading with the list rendered somewhere else would satisfy
    // the three comparisons above.
    for (const fed of WHAT_IT_FEEDS) {
      const at = open.indexOf(fed.handed);
      expect(at, fed.id).toBeGreaterThan(feeds);
      expect(at, fed.id).toBeLessThan(limits);
    }
  });

  it("keeps the chains out of the deliverables list", () => {
    // The two sections make different kinds of statement and the page renders
    // them as two lists. A chain's `feeds` appearing above the deliverables
    // heading would mean the lists had been merged, which is how the section
    // starts reading as something that arrives in the inbox.
    const got = open.indexOf("What you get back");
    for (const fed of WHAT_IT_FEEDS) expect(open.indexOf(fed.feeds), fed.id).toBeGreaterThan(got);
  });
});

describe("the form, both directions", () => {
  /** Field names are the contract with `requestDrawingSetRead`; a renamed one
   *  posts nothing and refuses with a sentence about a missing company. */
  const FIELDS = ["companyName", "contactName", "email", "phone", "trade", "projectName", "gcName"];

  it("renders the form when the offer is open", () => {
    expect(open).toContain("<form");
    for (const field of FIELDS) expect(open, field).toContain(`name="${field}"`);
  });

  it("renders NO form when the offer is closed", () => {
    expect(closed).not.toContain("<form");
    for (const field of FIELDS) expect(closed, field).not.toContain(`name="${field}"`);
  });

  it("gives every control a label that points at it", () => {
    const ids = [...open.matchAll(/<(?:input|select)[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(FIELDS.length);
    for (const id of ids) expect(open, id).toContain(`for="${id}"`);
  });

  it("asks for an email with an email keyboard and a phone with a phone one", () => {
    expect(open).toMatch(/name="email"[^>]*type="email"|type="email"[^>]*name="email"/);
    expect(open).toMatch(/name="phone"[^>]*type="tel"|type="tel"[^>]*name="phone"/);
    expect(open).toContain('inputMode="email"');
    expect(open).toContain('inputMode="tel"');
  });

  it("submits with a brand fill carrying a dark label, never white on yellow", () => {
    const submit = open.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
    expect(submit).toContain("bg-brand");
    expect(submit).toContain("text-neutral-900");
    expect(submit).not.toContain("text-white");
    // 56px, the primary-action floor — this page is opened on a phone from a
    // text message.
    expect(submit).toContain("min-h-[56px]");
  });

  it("marks only the optional fields optional", () => {
    const required = [...open.matchAll(/<input[^>]*\brequired\b[^>]*>/g)]
      .map((m) => m[0].match(/name="([^"]+)"/)?.[1])
      .sort();
    expect(required).toEqual(["companyName", "contactName", "email"]);
    expect((open.match(/\(optional\)/g) ?? []).length).toBe(4);
  });

  it("offers the trade as a picker rather than a text box", () => {
    expect(open).toMatch(/<select[^>]*name="trade"/);
  });
});

describe("the address on screen is the mechanism", () => {
  it("prints the intake address as a live mailto when there is one", () => {
    expect(open).toContain('href="mailto:help@example.com"');
  });

  it("prints no dead mailto when there is none", () => {
    expect(closed).not.toContain("mailto:");
    expect(closed).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
  });
});
