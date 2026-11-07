import { describe, expect, it } from "vitest";
import { isProviderOutage } from "./providerOutage";
import { creditError } from "./providerOutage.testutil";

describe("isProviderOutage", () => {
  it("IS an outage when the account is out of credit (the 2026-11-07 400), rate-limited, failing or overloaded, or unreachable", () => {
    expect(isProviderOutage(creditError())).toBe(true);
    expect(isProviderOutage(Object.assign(new Error("429"), { status: 429 }))).toBe(true);
    expect(isProviderOutage(Object.assign(new Error("500"), { status: 500 }))).toBe(true);
    expect(isProviderOutage(Object.assign(new Error("overloaded"), { status: 529 }))).toBe(true);
    expect(isProviderOutage(Object.assign(new Error("Connection error."), { name: "APIConnectionError" }))).toBe(true);
    expect(isProviderOutage(Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }))).toBe(true);
    // Wrapped by a caller, it is still found.
    expect(isProviderOutage(new Error("the read failed", { cause: creditError() }))).toBe(true);
  });

  it("is NOT an outage when the request or the reply was the problem: those stay ordinary, charged failures", () => {
    expect(isProviderOutage(Object.assign(new Error("400 prompt is too long"), { status: 400, error: { error: { message: "prompt is too long" } } }))).toBe(false);
    expect(isProviderOutage(new Error("The model returned something that is not JSON"))).toBe(false);
    expect(isProviderOutage(null)).toBe(false);
    expect(isProviderOutage("credit balance is too low")).toBe(false);
  });
});
