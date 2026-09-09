// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { attachStaleDeployListener, isStaleDeployError } from "./stale-deploy-error";

describe("isStaleDeployError", () => {
  it("recognizes webpack's own ChunkLoadError by name", () => {
    const err = new Error("Loading chunk 5635 failed.");
    err.name = "ChunkLoadError";
    expect(isStaleDeployError(err)).toBe(true);
  });

  it("recognizes the 'Loading chunk ... failed' message even with a generic error name", () => {
    expect(isStaleDeployError(new Error("Loading chunk 5635-a1b2c3.js failed."))).toBe(true);
  });

  it("recognizes a failed dynamic import", () => {
    expect(isStaleDeployError(new Error("Failed to fetch dynamically imported module: /_next/static/x.js"))).toBe(
      true,
    );
  });

  it("recognizes #118's own captured shape: a bare network-error TypeError from a _next/static stack", () => {
    const err = new TypeError("network error");
    err.stack = "TypeError: network error\n    at t (/_next/static/chunks/5635-abc123.js:1:2345)";
    expect(isStaleDeployError(err)).toBe(true);
  });

  it("does NOT flag an ordinary network error with no static-asset stack -- that's a real data-request failure", () => {
    const err = new TypeError("network error");
    err.stack = "TypeError: network error\n    at fetchInvoice (webpack-internal:///./lib/actions/billing.ts:10:1)";
    expect(isStaleDeployError(err)).toBe(false);
  });

  it("does NOT flag an unrelated error", () => {
    expect(isStaleDeployError(new Error("Contact not found"))).toBe(false);
  });

  it("does NOT flag a non-Error value", () => {
    expect(isStaleDeployError("network error")).toBe(false);
    expect(isStaleDeployError(null)).toBe(false);
    expect(isStaleDeployError(undefined)).toBe(false);
  });
});

describe("attachStaleDeployListener", () => {
  it("calls back on a matching window error event, and cleans up on detach", () => {
    const onDetect = vi.fn();
    const detach = attachStaleDeployListener(onDetect);

    const err = new Error("Loading chunk 9 failed.");
    window.dispatchEvent(Object.assign(new Event("error"), { error: err }));
    expect(onDetect).toHaveBeenCalledTimes(1);

    detach();
    window.dispatchEvent(Object.assign(new Event("error"), { error: err }));
    expect(onDetect).toHaveBeenCalledTimes(1);
  });

  it("calls back on a matching unhandled rejection", () => {
    const onDetect = vi.fn();
    attachStaleDeployListener(onDetect);

    const err = new Error("Failed to fetch dynamically imported module: x");
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: err }));
    expect(onDetect).toHaveBeenCalledTimes(1);
  });

  it("does not call back for an unrelated error", () => {
    const onDetect = vi.fn();
    attachStaleDeployListener(onDetect);

    window.dispatchEvent(Object.assign(new Event("error"), { error: new Error("Contact not found") }));
    expect(onDetect).not.toHaveBeenCalled();
  });
});
