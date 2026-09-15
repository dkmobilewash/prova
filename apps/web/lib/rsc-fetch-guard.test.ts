// @vitest-environment happy-dom
//
// These tests exercise the WRAPPER's own behaviour against a mocked
// global `fetch` -- they cannot and do not reproduce a real production
// 503 (nothing in this repo can; see CLAUDE.md's Neon/Vercel notes on why
// that's not reachable from a local run or an agent container). What they
// prove: given a response or a thrown error shaped like the ones #118
// captured, the guard classifies the request correctly, fires exactly
// once per qualifying failure, passes the original Response/rejection
// through completely untouched, and never fires for a request it should
// leave alone (an ordinary fetch, a background prefetch, an aborted
// request, or a non-5xx status).
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyRequest, installRscFailureGuard } from "./rsc-fetch-guard";

function response(status: number): Response {
  return new Response(null, { status });
}

describe("classifyRequest", () => {
  it("classifies a Server Action POST by its next-action header", () => {
    expect(classifyRequest("/settings", { headers: { "next-action": "abc123" } })).toBe("server-action");
  });

  it("classifies a live RSC navigation GET: rsc present, no prefetch header", () => {
    expect(classifyRequest("/compliance?_rsc=xyz", { headers: { rsc: "1" } })).toBe("rsc-navigation");
  });

  it("does NOT classify a background prefetch -- rsc present WITH the prefetch header", () => {
    expect(
      classifyRequest("/compliance?_rsc=xyz", { headers: { rsc: "1", "next-router-prefetch": "1" } }),
    ).toBeNull();
  });

  it("does not classify an ordinary app fetch with neither header", () => {
    expect(classifyRequest("/api/some-endpoint", { headers: { "content-type": "application/json" } })).toBeNull();
  });

  it("is case-insensitive on header names, matching a plain object with mixed case", () => {
    expect(classifyRequest("/x", { headers: { "Next-Action": "abc" } })).toBe("server-action");
  });

  it("reads headers off a Headers instance", () => {
    const h = new Headers();
    h.set("RSC", "1");
    expect(classifyRequest("/x", { headers: h })).toBe("rsc-navigation");
  });

  it("reads headers off an array-of-pairs init", () => {
    expect(classifyRequest("/x", { headers: [["next-action", "abc"]] })).toBe("server-action");
  });

  it("reads headers off a Request object when init carries none", () => {
    const req = new Request("https://example.test/compliance", { headers: { rsc: "1" } });
    expect(classifyRequest(req)).toBe("rsc-navigation");
  });
});

describe("installRscFailureGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires on a 503 for a Server Action POST, and returns the original response untouched", async () => {
    const mockResponse = response(503);
    window.fetch = vi.fn().mockResolvedValue(mockResponse);
    const onFailure = vi.fn();
    const uninstall = installRscFailureGuard(onFailure);

    const result = await window.fetch("/settings", { method: "POST", headers: { "next-action": "abc" } });

    expect(result).toBe(mockResponse);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith({ kind: "server-action", status: 503, url: "/settings" });
    uninstall();
  });

  it("fires on a 503 for a live RSC navigation GET, matching #118's own repro shape", async () => {
    const mockResponse = response(503);
    window.fetch = vi.fn().mockResolvedValue(mockResponse);
    const onFailure = vi.fn();
    const uninstall = installRscFailureGuard(onFailure);

    const result = await window.fetch("/compliance?_rsc=muEHyN_ISybGdhbu", { headers: { rsc: "1" } });

    expect(result).toBe(mockResponse);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][0]).toMatchObject({ kind: "rsc-navigation", status: 503 });
    uninstall();
  });

  it("does NOT fire on a 503 for a background prefetch -- no user-visible consequence by itself", async () => {
    window.fetch = vi.fn().mockResolvedValue(response(503));
    const onFailure = vi.fn();
    const uninstall = installRscFailureGuard(onFailure);

    await window.fetch("/compliance?_rsc=b2bxedLQ7kHqn9lG", { headers: { rsc: "1", "next-router-prefetch": "1" } });

    expect(onFailure).not.toHaveBeenCalled();
    uninstall();
  });

  it("does not fire on a successful response", async () => {
    window.fetch = vi.fn().mockResolvedValue(response(200));
    const onFailure = vi.fn();
    const uninstall = installRscFailureGuard(onFailure);

    await window.fetch("/compliance?_rsc=xyz", { headers: { rsc: "1" } });

    expect(onFailure).not.toHaveBeenCalled();
    uninstall();
  });

  it("does not fire on a 4xx -- this guard is about platform/server 5xx, not client errors", async () => {
    window.fetch = vi.fn().mockResolvedValue(response(404));
    const onFailure = vi.fn();
    const uninstall = installRscFailureGuard(onFailure);

    await window.fetch("/settings", { method: "POST", headers: { "next-action": "abc" } });

    expect(onFailure).not.toHaveBeenCalled();
    uninstall();
  });

  it("does not fire, and rethrows unchanged, on an aborted request", async () => {
    const abortError = new DOMException("The user aborted a request.", "AbortError");
    window.fetch = vi.fn().mockRejectedValue(abortError);
    const onFailure = vi.fn();
    const uninstall = installRscFailureGuard(onFailure);

    await expect(window.fetch("/compliance?_rsc=xyz", { headers: { rsc: "1" } })).rejects.toBe(abortError);
    expect(onFailure).not.toHaveBeenCalled();
    uninstall();
  });

  it("fires with status null on a genuine network error (thrown, not a response), and rethrows it unchanged", async () => {
    const networkError = new TypeError("network error");
    window.fetch = vi.fn().mockRejectedValue(networkError);
    const onFailure = vi.fn();
    const uninstall = installRscFailureGuard(onFailure);

    await expect(window.fetch("/settings", { method: "POST", headers: { "next-action": "abc" } })).rejects.toBe(
      networkError,
    );
    expect(onFailure).toHaveBeenCalledWith({ kind: "server-action", status: null, url: "/settings" });
    uninstall();
  });

  it("leaves an unrelated fetch completely alone, calling straight through", async () => {
    const mockResponse = response(503);
    window.fetch = vi.fn().mockResolvedValue(mockResponse);
    const onFailure = vi.fn();
    const uninstall = installRscFailureGuard(onFailure);

    const result = await window.fetch("/api/webhooks/thing", { method: "POST" });

    expect(result).toBe(mockResponse);
    expect(onFailure).not.toHaveBeenCalled();
    uninstall();
  });

  it("restores the original fetch on uninstall", async () => {
    const original = window.fetch;
    const uninstall = installRscFailureGuard(vi.fn());
    expect(window.fetch).not.toBe(original);
    uninstall();
    expect(window.fetch).toBe(original);
  });
});
