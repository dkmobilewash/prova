import { afterEach, describe, expect, it, vi } from "vitest";
import { MYCOI_API_UNAVAILABLE, fetchMyCoiCertificates } from "./api";

/**
 * The live adapter is a labelled stub. It must refuse in words and must
 * never reach a network — a stub that quietly called a guessed endpoint
 * would be presenting an undocumented API as working.
 */

afterEach(() => vi.restoreAllMocks());

describe("fetchMyCoiCertificates", () => {
  it("returns the partner-agreement refusal without making any request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in this test"));
    const result = await fetchMyCoiCertificates();
    expect(result).toEqual({ ok: false, reason: "partner-agreement-required", message: MYCOI_API_UNAVAILABLE });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
