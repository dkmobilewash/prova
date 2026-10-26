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
import { bidAuthHref } from "@/lib/bid/surface";

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
  it("sends a signed-in visitor to their bids, not the CRM", async () => {
    authUserId = "user_1";
    await expect(BidLandingPage()).rejects.toThrow("NEXT_REDIRECT: /bid/bids");
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
    const signUp = bidAuthHref("sign-up").replace(/&/g, "&amp;");
    const signIn = bidAuthHref("sign-in").replace(/&/g, "&amp;");
    expect(html.split(`href="${signUp}"`).length - 1).toBe(2);
    expect(html).toContain(`href="${signIn}"`);
    expect(html).not.toMatch(/href="\/sign-up"/);
  });

  it("offers the free drawing-set read on Bid's own route", () => {
    expect(html).toContain('href="/bid/wall-takeoff"');
  });

  it("makes no pricing claim and quotes no invented statistic", () => {
    expect(text).not.toMatch(/\$\s?\d|per month|\/mo\b|free trial/i);
    expect(text).not.toMatch(/\d+%|\d+\s*(minutes?|hours?|days?)\s+(saved|per|of)/i);
  });
});
