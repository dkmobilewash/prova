import { describe, expect, it } from "vitest";
import { outboundConfig } from "./push";

const full = {
  SMARTLEAD_API_KEY: "k",
  SMARTLEAD_CAMPAIGN_ID: "123",
  OUTBOUND_TOKEN_SECRET: "s",
  NOTIFY_BASE_URL: "https://app.cstream.ai/",
};

describe("outboundConfig", () => {
  it("is ready with all four, defaulting the cap to 50 and the base URL to its origin", () => {
    expect(outboundConfig(full)).toEqual({
      ok: true,
      apiKey: "k",
      campaignId: "123",
      tokenSecret: "s",
      baseUrl: "https://app.cstream.ai",
      dailyCap: 50,
    });
  });

  it("names every missing setting, including the two the unsubscribe link needs", () => {
    expect(outboundConfig({})).toEqual({
      ok: false,
      missing: ["SMARTLEAD_API_KEY", "SMARTLEAD_CAMPAIGN_ID", "OUTBOUND_TOKEN_SECRET", "NOTIFY_BASE_URL"],
    });
    expect(outboundConfig({ ...full, OUTBOUND_TOKEN_SECRET: " " })).toEqual({ ok: false, missing: ["OUTBOUND_TOKEN_SECRET"] });
    expect(outboundConfig({ ...full, NOTIFY_BASE_URL: "not a url" })).toEqual({ ok: false, missing: ["NOTIFY_BASE_URL"] });
  });

  it("reads the cap, and falls back on nonsense rather than sending unlimited", () => {
    expect(outboundConfig({ ...full, OUTBOUND_DAILY_CAP: "20" })).toMatchObject({ dailyCap: 20 });
    expect(outboundConfig({ ...full, OUTBOUND_DAILY_CAP: "0" })).toMatchObject({ dailyCap: 0 });
    expect(outboundConfig({ ...full, OUTBOUND_DAILY_CAP: "lots" })).toMatchObject({ dailyCap: 50 });
    expect(outboundConfig({ ...full, OUTBOUND_DAILY_CAP: "-5" })).toMatchObject({ dailyCap: 50 });
    // `Number("")` is 0, and .env.example ships it blank — blank must not mean "send none".
    expect(outboundConfig({ ...full, OUTBOUND_DAILY_CAP: "" })).toMatchObject({ dailyCap: 50 });
  });
});
