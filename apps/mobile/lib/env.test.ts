import { describe, expect, it } from "vitest";
import { configProblem } from "./env";

/**
 * A build that was never told where the server is.
 *
 * This is not a hypothetical: `apps/mobile/.env` is gitignored and Expo
 * does not upload it to EAS Build, so the first cloud build made without
 * eas.json supplying these would have installed, launched, and reported
 * "No connection" on every screen — blaming a jobsite for a mistake made
 * at build time. The check has to fire in a RELEASE build and stay quiet
 * on a laptop, where localhost is the correct answer.
 */

const LOCAL = "http://localhost:3000";
const REAL = "https://app.cstream.ai";
const KEY = "pk_live_example";

describe("what a build knows about itself", () => {
  it("says nothing when a real build has both values", () => {
    expect(configProblem({ apiUrl: REAL, clerkKey: KEY, isDev: false })).toBeNull();
  });

  it("leaves a laptop alone — localhost is the dev server, not a mistake", () => {
    expect(configProblem({ apiUrl: LOCAL, clerkKey: KEY, isDev: true })).toBeNull();
  });

  it("refuses to let a release build pretend localhost is a server", () => {
    const problem = configProblem({ apiUrl: LOCAL, clerkKey: KEY, isDev: false });
    expect(problem).toContain("EXPO_PUBLIC_API_URL");
    // The sentence has to say what to fix, not just that something is wrong.
    expect(problem).toContain("rebuilt");
  });

  it("catches a missing sign-in key in any build, dev included", () => {
    // An empty key is never right: on a laptop it throws inside the Clerk
    // provider, which is a crash with no explanation attached.
    expect(configProblem({ apiUrl: LOCAL, clerkKey: "", isDev: true })).toContain(
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
    );
    expect(configProblem({ apiUrl: REAL, clerkKey: "", isDev: false })).toContain(
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
    );
  });

  it("names BOTH when both are missing, rather than the first one it meets", () => {
    const problem = configProblem({ apiUrl: LOCAL, clerkKey: "", isDev: false });
    expect(problem).toContain("EXPO_PUBLIC_API_URL");
    expect(problem).toContain("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
  });
});
