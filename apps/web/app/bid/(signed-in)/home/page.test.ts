import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GUIDE_FIXTURES } from "@/lib/bid/guide/homeFixtures";
import { askButtonLabel, needsYou, progressLabel, progressSegments, dueLine, TONE_LABEL } from "@/lib/bid/guide/homeView";
import type { JobGuide } from "@/lib/bid/guide/types";

/**
 * C Stream Bid's home. The real page is rendered against real-shaped guides
 * (`lib/bid/guide/homeFixtures.ts`) and against NONE, and what is asserted is
 * what the home promises: every anchor stays under /bid, each tone's pill is the
 * right word on the right ground, the bar carries five segments in the right
 * colours, the "Needs you" list is exactly the jobs with an ask, and the box
 * offers only things that exist.
 */

let guides: JobGuide[] = [];
let gcRows: { id: string; name: string }[] = [{ id: "gc-1", name: "Hartwell" }];
let allowed = true;

const context = { company: { id: "company-1", name: "Test Drywall" }, id: "user-1", role: "OWNER", jobFunction: null };

vi.mock("@prova/db", () => ({ prisma: { contact: { findMany: vi.fn(async () => gcRows) } } }));
vi.mock("@/lib/authz", () => ({ requireCapability: vi.fn(async () => ({ allowed, context })) }));
vi.mock("@/lib/bid/guide", () => ({ getOpenJobGuides: vi.fn(async () => guides) }));
vi.mock("@/lib/actions", () => ({ createBidInvitation: vi.fn(), readBidInvitationText: vi.fn() }));

async function render() {
  const { default: Page } = await import("@/app/bid/(signed-in)/home/page");
  return renderToStaticMarkup((await Page()) as never);
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

describe("/bid/home with bids", () => {
  it("every anchor on the page stays inside Bid", async () => {
    guides = GUIDE_FIXTURES;
    const links = hrefs(await render());
    // Size first: a page that drew no anchors would pass "every anchor starts with /bid".
    // 5 bids + 4 "Needs you" buttons + the due chip + Attach drawings.
    expect(links.length).toBe(GUIDE_FIXTURES.length + needsYou(GUIDE_FIXTURES).length + 2);
    expect(links.filter((href) => !href.startsWith("/bid"))).toEqual([]);
  });

  it("lists every open bid down the side, each linking to its job, with the count", async () => {
    guides = GUIDE_FIXTURES;
    const html = await render();
    const side = html.slice(html.indexOf('data-bid="home-bids"'));
    expect(side).toContain(`Your bids &middot; ${GUIDE_FIXTURES.length} open`.replace("&middot;", "·"));
    for (const guide of GUIDE_FIXTURES) {
      expect(html).toContain(`href="/bid/estimates/${guide.jobId}"`);
      expect(side).toContain(guide.name);
      expect(side).toContain(guide.oneLine);
    }
    expect(html.match(/data-bid="home-bid"/g)?.length).toBe(GUIDE_FIXTURES.length);
    expect(side).toContain("Hartwell · due Thu");
    expect(side).toContain("Meridian Construction Group · due Fri 2:00 PM");
    // A job with a GC and no due line still shows the GC.
    expect(side).toContain("Hartwell</span>");
  });

  it("draws a five-segment bar per bid: green done, yellow current, grey todo", async () => {
    guides = GUIDE_FIXTURES;
    const html = await render();
    const bars = [...html.matchAll(/<div role="img" aria-label="([^"]*)"[^>]*data-bid="progress">(.*?)<\/div>/g)];
    expect(bars.length).toBe(GUIDE_FIXTURES.length);
    // Riverside: done, done, current, todo, todo.
    expect(bars[0][1]).toBe("2 of 5 steps done");
    const segments = [...bars[0][2].matchAll(/class="([^"]*)" data-status="(\w+)"/g)].map((m) => [m[2], m[1]]);
    expect(segments.map(([status]) => status)).toEqual(["done", "done", "current", "todo", "todo"]);
    expect(segments[0][1]).toContain("bg-tag-green-ink");
    expect(segments[2][1]).toContain("bg-tag-brand");
    expect(segments[3][1]).toContain("bg-line-row");
    for (const bar of bars) expect(bar[2].match(/data-status=/g)?.length).toBe(5);
  });

  it("colours each one-line status and each pill by the guide's tone, in words as well as colour", async () => {
    guides = GUIDE_FIXTURES;
    const html = await render();
    const pill = (tone: string) => html.match(new RegExp(`<span class="[^"]*" data-tone="${tone}">${TONE_LABEL[tone as keyof typeof TONE_LABEL]}</span>`));
    // Pills are on the "Needs you" list: the four toned jobs with an ask.
    expect(pill("question")?.[0]).toContain("bg-tag-amber text-tag-amber-ink");
    expect(pill("ready")?.[0]).toContain("bg-tag-green text-tag-green-ink");
    expect(pill("update")?.[0]).toContain("bg-tag-brand-soft text-tag-brand-soft-ink");
    expect(pill("blocked")?.[0]).toContain("bg-tag-rose text-tag-rose-ink");
    // The side list's line is tinted the same way.
    expect(html).toMatch(/text-tag-amber-ink" data-tone="question">W2 wall has no price/);
    expect(html).toMatch(/text-tag-green-ink" data-tone="ready">Proposal ready for 2 GCs/);
    expect(html).toMatch(/text-ink-body" data-tone="working">Reading 6 of 22 sheets\.\.\./);
    expect(html).toMatch(/text-tag-rose-ink" data-tone="blocked">No drawings uploaded/);
  });

  it("'Needs you' is exactly the jobs with an ask, with the primary action's words, linking to the job", async () => {
    guides = GUIDE_FIXTURES;
    const html = await render();
    const rows = html.match(/data-bid="home-needs"[\s\S]*?<\/li>/g) ?? [];
    const asked = GUIDE_FIXTURES.filter((g) => g.ask !== null);
    expect(asked.length).toBe(4);
    expect(rows.length).toBe(asked.length);
    // Oak Ave (no ask) is not on the list; the others are, with their button words.
    expect(rows.join("")).not.toContain("Oak Ave");
    const expected: [string, string][] = [
      ["Riverside Medical, L2", "Answer"],
      ["Civic Center Annex", "Review &amp; send"],
      ["North Hills School", "See change"],
      ["Lakeview Office Fit-out", "Add drawings"],
    ];
    for (const [name, label] of expected) {
      const row = rows.find((r) => r.includes(name));
      expect(row, name).toBeDefined();
      expect(row).toMatch(new RegExp(`href="/bid/estimates/job_[a-z]+"[^>]*>${label}</a>`));
    }
  });

  it("orders 'Needs you' by urgency: blocked, then a question, then ready, then an update", () => {
    expect(needsYou(GUIDE_FIXTURES).map((g) => g.tone)).toEqual(["blocked", "question", "ready", "update"]);
  });
});

describe("/bid/home with no bids", () => {
  it("shows the box and a short empty state, with no list and no pills", async () => {
    guides = [];
    const html = await render();
    expect(html).toContain("What are we bidding today?");
    expect(html).toContain('data-bid="home-ask"');
    expect(html).toContain("Your bids · 0 open");
    expect(html).toContain('data-bid="home-bids-empty"');
    expect(html).toContain('data-bid="home-needs-empty"');
    expect(html).not.toContain('data-bid="home-bid"');
    expect(html).not.toContain("data-tone=");
    expect(hrefs(html).filter((href) => !href.startsWith("/bid"))).toEqual([]);
  });
});

describe("the box", () => {
  it("offers pasting an invite and attaching drawings, and only chips that do something", async () => {
    guides = [];
    gcRows = [{ id: "gc-1", name: "Hartwell" }];
    const html = await render();
    expect(html).toContain("Paste a GC&#x27;s invite email, or attach the drawings");
    // Attach drawings is Bid's existing start-an-estimate screen.
    expect(html).toMatch(/data-bid="home-attach"[^>]*href="\/bid\/estimates\/new">Attach drawings</);
    // Exactly one chip: the bid log's due view. No "update prices" chip — Bid has no such screen.
    const chips = html.match(/data-bid="home-chips"[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(chips.match(/<li>/g)?.length).toBe(1);
    expect(chips).toContain('href="/bid/bids?view=due"');
    expect(chips).toContain("What’s due this week?");
    expect(html).not.toMatch(/update prices/i);
    // A GC is on file: the box is usable and says nothing needs adding.
    expect(html).not.toContain('data-bid="home-no-gcs"');
  });

  it("with no GC on file the box says so and links to where one is added", async () => {
    guides = [];
    gcRows = [];
    const html = await render();
    expect(html).toContain('data-bid="home-no-gcs"');
    expect(html).toContain('href="/bid/settings#gcs"');
    gcRows = [{ id: "gc-1", name: "Hartwell" }];
  });

  it("a person without the estimating capability sees why, not the home", async () => {
    allowed = false;
    try {
      const html = await render();
      expect(html).not.toContain("What are we bidding today?");
    } finally {
      allowed = true;
    }
  });
});

describe("the home's pure view helpers", () => {
  it("always gives five segments, defaulting a missing step to todo", () => {
    expect(progressSegments({ steps: [] })).toEqual(["todo", "todo", "todo", "todo", "todo"]);
    expect(progressSegments(GUIDE_FIXTURES[1])).toEqual(["done", "done", "done", "done", "current"]);
    expect(progressLabel(GUIDE_FIXTURES[1])).toBe("4 of 5 steps done");
  });

  it("falls back to the first action, then to 'Open', when none is primary", () => {
    expect(askButtonLabel(GUIDE_FIXTURES[3])).toBe("See change");
    expect(askButtonLabel({ ask: null })).toBe("Open");
  });

  it("joins the GC and due line, and returns null when there is neither", () => {
    expect(dueLine({ gcName: null, dueLabel: null })).toBeNull();
    expect(dueLine({ gcName: null, dueLabel: "due Thu" })).toBe("due Thu");
  });
});
