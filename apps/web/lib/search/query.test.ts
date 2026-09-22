import { describe, expect, it, vi } from "vitest";
import type { Principal } from "@/lib/permissions";
import type { SearchProvider } from "./types";
import { allowedProviders, globalSearch, providerCapability } from "./query";

const OWNER: Principal = { role: "OWNER", jobFunction: null };
const FIELD: Principal = { role: "MEMBER", jobFunction: "FIELD" };
const ESTIMATOR: Principal = { role: "MEMBER", jobFunction: "ESTIMATOR" };
const ACCOUNTING: Principal = { role: "MEMBER", jobFunction: "ACCOUNTING" };

/** A fake record, distinguishable from a real one only by its `type`. */
function fakeRecord(type: string) {
  return { kind: "record" as const, type, id: `${type}-1`, title: `${type} result`, subtitle: null, href: `/${type}` };
}

/** A route-gated fake provider whose `search` is a spy, so a test can
 * assert it was never CALLED — not merely that its results are absent,
 * which is the stronger claim this feature exists to make: a person who
 * cannot reach a capability causes no query to run for it at all. */
function fakeRouteProvider(type: string, route: string): SearchProvider & { search: ReturnType<typeof vi.fn> } {
  return {
    type,
    label: type,
    gate: "route",
    route,
    search: vi.fn(async () => [fakeRecord(type)]),
  };
}

function fakeToolProvider(type: string, toolName: string): SearchProvider & { search: ReturnType<typeof vi.fn> } {
  return {
    type,
    label: type,
    gate: "tool",
    toolName: toolName as never,
    search: vi.fn(async () => [fakeRecord(type)]),
  };
}

describe("providerCapability — the function that decides who sees a result type", () => {
  it("derives a route-gated provider's capability from capabilityForRoute, not a field on the provider", () => {
    expect(providerCapability(fakeRouteProvider("rfi", "/rfis"))).toBe("MANAGE_JOBS");
  });

  it("returns null for a route with no ROUTE_CAPABILITY entry — genuinely open", () => {
    expect(providerCapability(fakeRouteProvider("contact", "/contacts"))).toBeNull();
  });

  it("derives a tool-gated provider's capability from the named Ask tool", () => {
    expect(providerCapability(fakeToolProvider("changeOrder", "change_order_status"))).toBe("VIEW_JOB_COSTS");
    expect(providerCapability(fakeToolProvider("invoice", "pay_application_status"))).toBe("MANAGE_BILLING");
  });

  it("throws — refuses to treat it as open — when a tool-gated provider cites a tool that does not exist", () => {
    // Not `?? null`: a dead citation is a coding error, and treating it as
    // "no gate" would be the exact silent-leak shape this whole feature
    // exists to prevent.
    expect(() => providerCapability(fakeToolProvider("ghost", "not_a_real_tool"))).toThrow(/not_a_real_tool/);
  });
});

describe("allowedProviders — capability filtering, before any query runs", () => {
  const providers = [fakeRouteProvider("rfi", "/rfis"), fakeRouteProvider("contact", "/contacts")];

  it("gives an OWNER every provider", () => {
    expect(allowedProviders(OWNER, providers).map((p) => p.type)).toEqual(["rfi", "contact"]);
  });

  it("withholds a gated provider from a role lacking the capability", () => {
    // ACCOUNTING holds MANAGE_BILLING/VIEW_COMPANY_FINANCIALS/VIEW_JOB_COSTS,
    // not MANAGE_JOBS — see lib/permissions.ts's BY_FUNCTION table.
    expect(allowedProviders(ACCOUNTING, providers).map((p) => p.type)).toEqual(["contact"]);
  });

  it("keeps an open provider for everyone", () => {
    expect(allowedProviders(FIELD, providers).map((p) => p.type)).toContain("contact");
  });
});

describe("globalSearch — the merged, capability-filtered response", () => {
  it("never calls a gated provider's search function at all for a role lacking the capability — not filtered after the fact, never invoked", async () => {
    const rfi = fakeRouteProvider("rfi", "/rfis"); // MANAGE_JOBS
    const contact = fakeRouteProvider("contact", "/contacts"); // open
    // ACCOUNTING lacks MANAGE_JOBS.
    const result = await globalSearch({ companyId: "co_1", principal: ACCOUNTING, query: "acme" }, [rfi, contact]);

    expect(rfi.search).not.toHaveBeenCalled();
    expect(contact.search).toHaveBeenCalledTimes(1);
    expect(result.records.map((r) => r.type)).toEqual(["contact"]);
  });

  it("calls a gated provider's search, and includes its results, for a role holding the capability", async () => {
    const rfi = fakeRouteProvider("rfi", "/rfis");
    const result = await globalSearch({ companyId: "co_1", principal: ESTIMATOR, query: "acme" }, [rfi]);
    expect(rfi.search).toHaveBeenCalledTimes(1);
    expect(result.records.map((r) => r.type)).toEqual(["rfi"]);
  });

  it("scopes every provider call to the caller's companyId, never a different one", async () => {
    const rfi = fakeRouteProvider("rfi", "/rfis");
    await globalSearch({ companyId: "co_target", principal: OWNER, query: "acme" }, [rfi]);
    expect(rfi.search).toHaveBeenCalledWith(expect.objectContaining({ companyId: "co_target" }));
  });

  it("returns nothing at all, and calls no provider, for a query under the minimum length", async () => {
    const rfi = fakeRouteProvider("rfi", "/rfis");
    const result = await globalSearch({ companyId: "co_1", principal: OWNER, query: "a" }, [rfi]);
    expect(rfi.search).not.toHaveBeenCalled();
    expect(result).toEqual({ records: [], pages: [] });
  });

  it("returns nothing for an empty or whitespace-only query", async () => {
    const rfi = fakeRouteProvider("rfi", "/rfis");
    expect((await globalSearch({ companyId: "co_1", principal: OWNER, query: "   " }, [rfi])).records).toEqual([]);
  });

  it("merges every allowed provider's results into one flat records list", async () => {
    const rfi = fakeRouteProvider("rfi", "/rfis");
    const contact = fakeRouteProvider("contact", "/contacts");
    const result = await globalSearch({ companyId: "co_1", principal: OWNER, query: "acme" }, [rfi, contact]);
    expect(result.records.map((r) => r.type).sort()).toEqual(["contact", "rfi"]);
  });

  it("includes page results from the app's own walkthroughs, filtered to what this person can reach", async () => {
    // No fake record providers — isolates the page half, which reuses
    // reachableWalkthroughs/searchAppHelp rather than a second index.
    const forField = await globalSearch({ companyId: "co_1", principal: FIELD, query: "backcharge" }, []);
    // FIELD holds MANAGE_FIELD/MANAGE_JOBS, not MANAGE_BILLING — /backcharges
    // must not be offered as a page result either.
    expect(forField.pages.find((p) => p.route === "/backcharges")).toBeUndefined();

    const forOwner = await globalSearch({ companyId: "co_1", principal: OWNER, query: "backcharge" }, []);
    expect(forOwner.pages[0]?.route).toBe("/backcharges");
  });
});
