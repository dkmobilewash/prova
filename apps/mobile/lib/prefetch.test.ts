import { beforeEach, describe, expect, it, vi } from "vitest";

/** Filling the cache while there is still signal. */

const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: async (k: string) => {
      store.delete(k);
    },
  },
}));

let failing = new Set<string>();
const list = (name: string) => async () => {
  if (failing.has(name)) throw new TypeError("Network request failed");
  return [name];
};

vi.mock("./api", () => ({
  listPunchListItems: list("punch"),
  listFieldReports: list("reports"),
  listMedia: list("media"),
  listTimeEntries: list("time"),
  listMaterialOrders: list("orders"),
  listVendors: list("vendors"),
  listToolboxTalks: list("talks"),
  listIncidents: list("incidents"),
  listTmTickets: list("tickets"),
}));

const { prefetchJob } = await import("./prefetch");
const { cacheGet } = await import("./offline-cache");

beforeEach(() => {
  store.clear();
  failing = new Set();
});

describe("prefetching a job", () => {
  it("fills every section the screens read", async () => {
    expect(await prefetchJob("job_1", "token")).toBe(7);
    for (const key of [
      "punch-list.job_1",
      "reports.job_1",
      "photos.job_1",
      "time.job_1",
      "materials.job_1",
      "safety.job_1",
      "tickets.job_1",
    ]) {
      expect(await cacheGet(key), key).not.toBeNull();
    }
  });

  it("keeps what landed when signal dies halfway through", async () => {
    // The normal case, not the exotic one: a truck leaving a yard.
    failing.add("orders");
    failing.add("talks");
    expect(await prefetchJob("job_1", "token")).toBe(5);
    expect(await cacheGet("punch-list.job_1")).not.toBeNull();
    expect(await cacheGet("materials.job_1")).toBeNull();
  });

  it("does not throw when there is no signal at all", async () => {
    failing = new Set(["punch", "reports", "media", "time", "orders", "vendors", "talks", "incidents", "tickets"]);
    await expect(prefetchJob("job_1", "token")).resolves.toBe(0);
  });

  it("keeps the two-list sections together", async () => {
    await prefetchJob("job_1", "token");
    expect((await cacheGet<{ orders: string[]; vendors: string[] }>("materials.job_1"))?.rows).toEqual({
      orders: ["orders"],
      vendors: ["vendors"],
    });
  });
});
