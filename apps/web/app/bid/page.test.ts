/**
 * C Stream Bid's landing page (`/bid`, served at bid.cstream.ai/).
 *
 * The redirect is asserted in BOTH directions, the shape `app/page.test.ts`
 * uses: a redirect that always fires and one that never fires would each pass
 * a test that checks only one.
 *
 * The content checks are the honesty rules from the component's header, made
 * executable where a string can carry them: the one sentence, the four steps,
 * the AI/code split, the sign-up link carrying Bid's redirect_url (the SAME
 * string `bidAuthHref` builds, so the two cannot drift), and no price or
 * invented statistic.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BID_HOME, bidAuthDestination, bidAuthHref, isBidSignedInPath } from "@/lib/bid/surface";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { priority: _priority, ...rest } = props;
    return createElement("img", rest);
  },
}));

let authUserId: string | null = null;
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: authUserId }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT: ${to}`);
  },
}));

const { default: BidLandingPage } = await import("./page");
const { BidLanding } = await import("@/components/bid/BidLanding");

describe("/bid", () => {
  it("sends a signed-in visitor to the Bid home, not the CRM", async () => {
    authUserId = "user_1";
    await expect(BidLandingPage()).rejects.toThrow(`NEXT_REDIRECT: ${BID_HOME}`);
    expect(BID_HOME).toBe("/bid/home");
  });

  it("renders the landing page for a signed-out visitor", async () => {
    authUserId = null;
    const html = renderToStaticMarkup(await BidLandingPage());
    expect(html).toContain("C Stream Bid takes a wall job from the invite to the proposal");
  });
});

describe("BidLanding", () => {
  const html = renderToStaticMarkup(createElement(BidLanding));
  const text = html.replace(/<[^>]+>/g, " ");

  it("says the one sentence, the four steps, and who does the maths", () => {
    expect(text).toContain("so you never type it twice");
    for (const step of ["Log the invite", "Measure the walls", "Price it the way your shop does", "Send the proposal"]) {
      expect(text).toContain(step);
    }
    expect(html.match(/>Step \d</g)?.length).toBe(4);
    expect(text).toContain("The AI reads. It never does the maths.");
  });

  it("its sign-up and sign-in links bring a person back to Bid", () => {
    // BidLanding spells its own redirect_url (`%2Fbid%2Fbids`, the bid log) and
    // is deliberately untouched by the Bid-home change, so it can no longer be
    // compared with `bidAuthHref` (now `/bid/home`). What it must still do is
    // send a person to a SIGNED-IN BID PAGE, never the CRM's /dashboard.
    const hrefs = [...html.matchAll(/href="(\/sign-(?:up|in)\?redirect_url=[^"]+)"/g)].map((m) =>
      m[1].replace(/&amp;/g, "&"),
    );
    // Header sign-in + sign-up, hero, closing section: the same four as before.
    expect(hrefs.length).toBe(4);
    expect(hrefs.filter((h) => h.startsWith("/sign-up?")).length).toBe(3);
    for (const href of hrefs) {
      const target = decodeURIComponent(href.split("redirect_url=")[1]);
      expect(isBidSignedInPath(target), href).toBe(true);
      expect(bidAuthDestination("localhost:3000", target), href).toBe(target);
    }
    // And the string the Bid surface itself draws goes to the home.
    expect(bidAuthHref("sign-up")).toBe("/sign-up?redirect_url=%2Fbid%2Fhome");
    expect(html).not.toMatch(/href="\/sign-up"/);
  });

  it("offers the free drawing-set read on Bid's own route", () => {
    expect(html).toContain('href="/bid/wall-takeoff"');
  });

  // THE EXAMPLE JOB is the one place a dollar figure may appear: it draws one
  // made-up job through the four steps to show the same bid total at the recap
  // and on the proposal. It must be exactly one marked block and must say
  // "Example job" on screen; everything OUTSIDE it is held to no figures at all.
  const examples = html.match(/<figure[^>]*data-bid="example"[\s\S]*?<\/figure>/g) ?? [];
  const outsideExample = examples.reduce((rest, block) => rest.replace(block, ""), html).replace(/<[^>]+>/g, " ");

  it("has exactly one example job, and it says so on screen", () => {
    expect(examples).toHaveLength(1);
    expect(examples[0] ?? "").toContain(">Example job<");
    // The point of the picture: the same total at the recap and on the proposal.
    const totals = (examples[0] ?? "").match(/\$78,350\.00/g) ?? [];
    expect(totals).toHaveLength(2);
  });

  it("makes no pricing claim and quotes no invented statistic outside the example job", () => {
    // The rest of the page really was read: a broken extraction cannot pass as "no figures".
    expect(outsideExample.length).toBeGreaterThan(1_000);
    expect(outsideExample).toContain("so you never type it twice");
    expect(outsideExample).toContain("The AI reads. It never does the maths.");
    expect(outsideExample).not.toMatch(/\$\s?\d|per month|\/mo\b|free trial/i);
    expect(outsideExample).not.toMatch(/\d+%|\d+\s*(minutes?|hours?|days?)\s+(saved|per|of)/i);
    // And nothing in the example job is a price or a claim about the product.
    // Its VISIBLE words — the animation's own <style> (keyframe percentages) is
    // not page text and is stripped first.
    const exampleText = (examples[0] ?? "").replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
    expect(exampleText).toContain("Bid total");
    expect(exampleText).not.toMatch(/per month|\/mo\b|free trial|\d+%/i);
  });
});
