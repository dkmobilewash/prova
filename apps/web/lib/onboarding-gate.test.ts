import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectCalls: string[] = [];

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectCalls.push(url);
    // The real `redirect()` throws a special value Next.js catches at the
    // top of the request; mirroring that here means a call site that reads
    // `subject` AFTER calling it (a bug this test wants to catch) will not
    // quietly keep running, same as it would not in production.
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const { shouldGateToOnboarding, redirectToOnboardingIfUnasked, redirectAwayFromOnboardingIfAsked } = await import(
  "./onboarding-gate"
);

beforeEach(() => {
  redirectCalls.length = 0;
});

const NEW_OWNER = { role: "OWNER", businessScopeAskedAt: null };
const ASKED_OWNER = { role: "OWNER", businessScopeAskedAt: new Date("2026-09-21") };
const NEW_MEMBER = { role: "MEMBER", businessScopeAskedAt: null };
const ASKED_MEMBER = { role: "MEMBER", businessScopeAskedAt: new Date("2026-09-21") };

describe("shouldGateToOnboarding", () => {
  it("is true only for an owner never asked", () => {
    expect(shouldGateToOnboarding(NEW_OWNER)).toBe(true);
  });

  it("is false once businessScopeAskedAt is set — the 'skipped is not never-asked-again' rule", () => {
    expect(shouldGateToOnboarding(ASKED_OWNER)).toBe(false);
  });

  it("is false for a member, even on a company nobody has answered for — a member cannot answer it", () => {
    expect(shouldGateToOnboarding(NEW_MEMBER)).toBe(false);
  });

  it("is false for an asked member too", () => {
    expect(shouldGateToOnboarding(ASKED_MEMBER)).toBe(false);
  });
});

describe("redirectToOnboardingIfUnasked — the only call site is dashboard/page.tsx", () => {
  it("sends a never-asked owner to /welcome", () => {
    expect(() => redirectToOnboardingIfUnasked(NEW_OWNER)).toThrow("NEXT_REDIRECT:/welcome");
    expect(redirectCalls).toEqual(["/welcome"]);
  });

  it("leaves an already-asked owner alone — the regression that matters most for a SKIPPED company", () => {
    redirectToOnboardingIfUnasked(ASKED_OWNER);
    expect(redirectCalls).toEqual([]);
  });

  it("leaves a member alone regardless of the company's answers", () => {
    redirectToOnboardingIfUnasked(NEW_MEMBER);
    redirectToOnboardingIfUnasked(ASKED_MEMBER);
    expect(redirectCalls).toEqual([]);
  });
});

describe("redirectAwayFromOnboardingIfAsked — the only call site is app/welcome/page.tsx, and this is what stops it being a trap", () => {
  it("lets a never-asked owner stay on the page", () => {
    redirectAwayFromOnboardingIfAsked(NEW_OWNER);
    expect(redirectCalls).toEqual([]);
  });

  it("bounces an already-asked owner back to /dashboard — a stale bookmark cannot re-arm the prompt", () => {
    expect(() => redirectAwayFromOnboardingIfAsked(ASKED_OWNER)).toThrow("NEXT_REDIRECT:/dashboard");
    expect(redirectCalls).toEqual(["/dashboard"]);
  });

  it("bounces a member away — they were never meant to see this page at all", () => {
    expect(() => redirectAwayFromOnboardingIfAsked(NEW_MEMBER)).toThrow("NEXT_REDIRECT:/dashboard");
    expect(redirectCalls).toEqual(["/dashboard"]);
  });

  it("is the exact logical inverse of redirectToOnboardingIfUnasked for every subject shape", () => {
    for (const subject of [NEW_OWNER, ASKED_OWNER, NEW_MEMBER, ASKED_MEMBER]) {
      redirectCalls.length = 0;
      let inFired = false;
      try {
        redirectToOnboardingIfUnasked(subject);
      } catch {
        inFired = true;
      }
      redirectCalls.length = 0;
      let outFired = false;
      try {
        redirectAwayFromOnboardingIfAsked(subject);
      } catch {
        outFired = true;
      }
      expect(inFired, JSON.stringify(subject)).toBe(!outFired);
    }
  });
});
