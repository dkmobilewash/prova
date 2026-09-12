import { describe, expect, it } from "vitest";
import { PROVIDERS, isProviderVisible } from "./registry";

/**
 * The Sandbox connector is a test connection to nothing, and it was the FIRST
 * card on Settings → Integrations and the holder of the only working Connect
 * button on the page. A new contractor's first offered integration was the
 * one that does nothing.
 *
 * It stays in the registry — the sync log and the connect/disconnect path
 * still have to be exercisable somewhere — and stops being shown to people
 * with real work to do.
 */

const sandbox = PROVIDERS.find((entry) => entry.provider === "SANDBOX");
const quickBooks = PROVIDERS.find((entry) => entry.provider === "QUICKBOOKS");

describe("the registry still describes the providers this test is about", () => {
  // Anti-vacuity: every case below reads one of these two entries, and a
  // `find` that returned undefined would make the assertions meaningless
  // rather than failing.
  it("has both a Sandbox and a QuickBooks entry", () => {
    expect(sandbox).toBeDefined();
    expect(quickBooks).toBeDefined();
  });

  it("marks exactly one entry as a development-only fixture", () => {
    expect(PROVIDERS.filter((entry) => entry.devOnly).map((entry) => entry.provider)).toEqual([
      "SANDBOX",
    ]);
  });
});

describe("isProviderVisible", () => {
  it("hides the fixture outside development", () => {
    expect(isProviderVisible(sandbox!, { isDevelopment: false, hasConnection: false })).toBe(false);
  });

  it("shows it in development, which is what it is for", () => {
    expect(isProviderVisible(sandbox!, { isDevelopment: true, hasConnection: false })).toBe(true);
  });

  it("shows it in production to a company that already connected it", () => {
    // Its Disconnect button is the only way to undo that. Hiding the card
    // would strand the row rather than tidy it away.
    expect(isProviderVisible(sandbox!, { isDevelopment: false, hasConnection: true })).toBe(true);
  });

  it("never hides a real provider, in any environment", () => {
    for (const entry of PROVIDERS.filter((provider) => !provider.devOnly)) {
      expect(isProviderVisible(entry, { isDevelopment: false, hasConnection: false })).toBe(true);
      expect(isProviderVisible(entry, { isDevelopment: true, hasConnection: false })).toBe(true);
    }
  });
});
