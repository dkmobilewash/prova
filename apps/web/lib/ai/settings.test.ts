import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HAIKU_4_5, OPUS_5 } from "@prova/integrations/src/models";

/**
 * The per-company AI switch itself.
 *
 * `aiFeatureGateCensus.test.ts` proves every model caller goes THROUGH this
 * module. This file proves the module decides correctly — the two together are
 * the claim "every AI feature can be switched off", and neither half is worth
 * anything alone.
 *
 * The cases worth having are the ones where a wrong answer is expensive rather
 * than merely wrong: an absent row must mean ON (or the migration switches the
 * product off under every existing customer), a read that FAILS must mean OFF
 * (or the switch is a promise kept most of the time), and a refusal must be a
 * returned sentence rather than a throw (or production shows an error boundary
 * on a feature somebody deliberately turned off).
 */

const findUnique = vi.fn();
vi.mock("@prova/db", () => ({ prisma: { companyAiSettings: { findUnique } } }));

const { AI_FEATURE_KEYS, AI_FEATURE_LABEL, AI_SETTINGS_DEFAULTS, aiFeatureRefusal, aiGate, aiSettingsFor } =
  await import("./settings");

const row = (over: Partial<{ aiEnabled: boolean; disabledFeatures: string[]; planSheetsPerMonth: number; modelOverride: string | null }> = {}) => ({
  aiEnabled: true,
  disabledFeatures: [] as string[],
  planSheetsPerMonth: 1500,
  modelOverride: null as string | null,
  ...over,
});

beforeEach(() => {
  findUnique.mockReset();
  delete process.env.ANTHROPIC_MODEL_DEFAULT;
  delete process.env.ANTHROPIC_MODEL_LEAD_SEARCH;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a company with no settings row", () => {
  it("has AI ON, every feature enabled — absent is not off", async () => {
    findUnique.mockResolvedValue(null);
    expect(await aiSettingsFor("co-1")).toEqual(AI_SETTINGS_DEFAULTS);
    expect(AI_SETTINGS_DEFAULTS.aiEnabled).toBe(true);
    expect(AI_SETTINGS_DEFAULTS.disabledFeatures).toEqual([]);
  });

  it("passes every feature, so the migration cannot switch the product off", async () => {
    findUnique.mockResolvedValue(null);
    for (const feature of AI_FEATURE_KEYS) {
      const gate = await aiGate("co-1", feature);
      expect(gate.ok, `${feature} refused for a company with no row`).toBe(true);
    }
  });
});

describe("the master switch", () => {
  it("refuses every feature, in a sentence naming who can turn it back on", async () => {
    findUnique.mockResolvedValue(row({ aiEnabled: false }));
    for (const feature of AI_FEATURE_KEYS) {
      const gate = await aiGate("co-1", feature);
      expect(gate.ok).toBe(false);
      if (gate.ok) continue;
      expect(gate.error).toContain("AI is switched off for your company");
      // The person meeting this has no other way to find out: the switch is
      // owner-only and on a page they may not be able to open.
      expect(gate.error).toContain("account owner");
      expect(gate.error).toContain("Settings");
    }
  });
});

describe("one feature at a time", () => {
  it("refuses only the feature that is off, and names it in the person's words", async () => {
    findUnique.mockResolvedValue(row({ disabledFeatures: ["COMPLIANCE_EXTRACT"] }));
    const off = await aiGate("co-1", "COMPLIANCE_EXTRACT");
    expect(off.ok).toBe(false);
    if (!off.ok) {
      expect(off.error).toContain(AI_FEATURE_LABEL.COMPLIANCE_EXTRACT);
      // Never the raw key. `COMPLIANCE_EXTRACT` in a sentence reads to a
      // person like a bug, which is the whole reason for the label map.
      expect(off.error).not.toContain("COMPLIANCE_EXTRACT");
    }
    // And everything else still runs — a list rather than one flag is the
    // point: a company may want the assistant and not want its drawings read.
    for (const feature of AI_FEATURE_KEYS.filter((key) => key !== "COMPLIANCE_EXTRACT")) {
      expect((await aiGate("co-1", feature)).ok, feature).toBe(true);
    }
  });

  it("gives every feature a label, so no refusal can print a raw key", () => {
    for (const feature of AI_FEATURE_KEYS) {
      expect(AI_FEATURE_LABEL[feature], feature).toBeTruthy();
      expect(AI_FEATURE_LABEL[feature]).not.toBe(feature);
    }
    // The label map is also where `AI_FEATURE_KEYS` comes from, deliberately —
    // reading `AI_FEATURES` out of the barrel at import time took eight test
    // files red. So the count is worth pinning: it is the enum's size.
    expect(AI_FEATURE_KEYS).toHaveLength(Object.keys(AI_FEATURE_LABEL).length);
    expect(AI_FEATURE_KEYS.length).toBeGreaterThanOrEqual(7);
  });
});

describe("when the settings cannot be read at all", () => {
  it("FAILS CLOSED — refuses, in a sentence, and never throws", async () => {
    findUnique.mockRejectedValue(new Error("connection pool timeout"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const gate = await aiGate("co-1", "ASK");
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.error).toContain("nothing was sent to a model");
    }

    // Metadata in the log, never a question, a document or a file name.
    expect(errors).toHaveBeenCalledWith("[ai] settings unreadable, refusing", { companyId: "co-1", feature: "ASK" });
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).not.toContain("connection pool timeout");
  });

  it("refuses rather than throwing, because production redacts a thrown message", async () => {
    findUnique.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The assertion is that this resolves at all. A `rejects` here would mean
    // every gated action shows "something went wrong" instead of a sentence.
    await expect(aiGate("co-1", "WIP_NARRATIVE")).resolves.toMatchObject({ ok: false });
  });

  it("is the opposite of the courtesy rate limit, on purpose", async () => {
    // Recorded as a test rather than only a comment because the two live next
    // door to each other and the wrong one is easy to copy: `askAllowance`
    // fails OPEN (#257) because a counter that will not read should not stop a
    // person; this fails CLOSED because a privacy promise that opens when it
    // cannot read itself was never a promise. Same shape as the PAID cap.
    findUnique.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await aiGate("co-1", "LEAD_SEARCH")).ok).toBe(false);
  });
});

describe("the model a passing gate hands back", () => {
  it("is the feature's default when the company has no override", async () => {
    findUnique.mockResolvedValue(null);
    const gate = await aiGate("co-1", "LEAD_SEARCH");
    expect(gate).toMatchObject({ ok: true, model: OPUS_5, modelSource: "feature-default" });
  });

  it("is the cheap model for plan ingestion, which is the one deliberate exception", async () => {
    findUnique.mockResolvedValue(null);
    // Three hundred calls per plan set is where a fifth of the price is worth
    // having. The eval decides whether it stays — this only pins that the
    // decision is wired, not that it is right.
    expect(await aiGate("co-1", "PLAN_INGESTION")).toMatchObject({ ok: true, model: HAIKU_4_5 });
  });

  it("is the company's override when it has one, and says where it came from", async () => {
    findUnique.mockResolvedValue(row({ modelOverride: HAIKU_4_5 }));
    expect(await aiGate("co-1", "ASK")).toMatchObject({
      ok: true,
      model: HAIKU_4_5,
      modelSource: "company-override",
    });
  });

  it("IGNORES an unknown override rather than passing it through", async () => {
    findUnique.mockResolvedValue(row({ modelOverride: "claude-opus-5-20260101" }));
    // A date-suffixed or typo'd id would 404 on every single call for this
    // company, which reaches a person as "the assistant is unavailable" — the
    // same screen as a missing key, with nothing naming the cause. So the
    // gate falls back to a model that works.
    expect(await aiGate("co-1", "ASK")).toMatchObject({
      ok: true,
      model: OPUS_5,
      modelSource: "feature-default",
    });
  });

  it("lets an operator move one feature with an env var, under the company's override", async () => {
    process.env.ANTHROPIC_MODEL_LEAD_SEARCH = HAIKU_4_5;
    findUnique.mockResolvedValue(null);
    expect(await aiGate("co-1", "LEAD_SEARCH")).toMatchObject({ model: HAIKU_4_5, modelSource: "feature-env" });

    findUnique.mockResolvedValue(row({ modelOverride: OPUS_5 }));
    // The company is more specific than the operator's env var, so it wins.
    expect(await aiGate("co-1", "LEAD_SEARCH")).toMatchObject({ model: OPUS_5, modelSource: "company-override" });
  });
});

describe("aiFeatureRefusal on its own", () => {
  it("returns null for a feature that may run — null is the pass", () => {
    expect(aiFeatureRefusal(AI_SETTINGS_DEFAULTS, "ASK")).toBeNull();
  });

  it("is pure: it reads settings and does not touch the database", () => {
    findUnique.mockRejectedValue(new Error("must not be called"));
    expect(aiFeatureRefusal({ ...AI_SETTINGS_DEFAULTS, aiEnabled: false }, "ASK")).toContain("switched off");
    expect(findUnique).not.toHaveBeenCalled();
  });
});
