import { describe, expect, it } from "vitest";
import { QUICKBOOKS_REQUIRED_ENV, quickBooksConnectCardState, quickBooksSetup } from "./quickbooks-setup";

/**
 * The QuickBooks Connect button with its keys missing must SAY it is not
 * set up, and offer nothing to press — not a button that redirects to
 * `/api/quickbooks/start`, which throws once it gets there
 * (`readQuickBooksConfig` in packages/integrations/src/quickbooks.ts) and
 * 500s. These are the pure decisions `/settings` renders from.
 */

const ALL = {
  QUICKBOOKS_CLIENT_ID: "a",
  QUICKBOOKS_CLIENT_SECRET: "b",
  QUICKBOOKS_REDIRECT_URI: "c",
};

describe("quickBooksSetup", () => {
  it("is unconfigured with nothing set, and names every missing variable", () => {
    expect(quickBooksSetup({})).toEqual({ configured: false, missing: [...QUICKBOOKS_REQUIRED_ENV] });
  });

  it("names exactly the one variable missing, not the ones already set", () => {
    expect(quickBooksSetup({ ...ALL, QUICKBOOKS_REDIRECT_URI: undefined })).toEqual({
      configured: false,
      missing: ["QUICKBOOKS_REDIRECT_URI"],
    });
  });

  it("treats a blank or whitespace-only value the same as missing", () => {
    expect(quickBooksSetup({ ...ALL, QUICKBOOKS_CLIENT_SECRET: "   " })).toEqual({
      configured: false,
      missing: ["QUICKBOOKS_CLIENT_SECRET"],
    });
  });

  it("is configured once all three, and only three, are set", () => {
    expect(quickBooksSetup(ALL)).toEqual({ configured: true, missing: [] });
  });

  it("does not require INTEGRATION_TOKEN_KEY — QuickBooks stores tokens in its own plaintext columns, not the encrypted envelope", () => {
    expect(QUICKBOOKS_REQUIRED_ENV).not.toContain("INTEGRATION_TOKEN_KEY");
    expect(quickBooksSetup({ ...ALL, INTEGRATION_TOKEN_KEY: undefined })).toEqual({
      configured: true,
      missing: [],
    });
  });

  it("never returns a variable's VALUE — only names, in `missing`, and a boolean", () => {
    const secretValue = "sk_live_do_not_leak_this_9f3a7c21";
    const result = quickBooksSetup({ QUICKBOOKS_CLIENT_SECRET: secretValue });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretValue);
    // The only strings `missing` may contain are the fixed variable names.
    for (const name of result.missing) {
      expect(QUICKBOOKS_REQUIRED_ENV).toContain(name);
    }
  });
});

describe("quickBooksConnectCardState", () => {
  it("is not-set-up whenever the install lacks keys — even for a company with a connection row already", () => {
    expect(quickBooksConnectCardState(false, false)).toBe("not-set-up");
    expect(quickBooksConnectCardState(false, true)).toBe("not-set-up");
  });

  it("offers Connect once set up with no connection yet, and reads as connected once one exists", () => {
    expect(quickBooksConnectCardState(true, false)).toBe("connect");
    expect(quickBooksConnectCardState(true, true)).toBe("connected");
  });
});
