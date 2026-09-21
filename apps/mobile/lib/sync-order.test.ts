import { describe, expect, it, vi } from "vitest";
import { syncOnce } from "./sync-order";

/**
 * The device bug this file exists for, found on a phone on 2026-09-20 and
 * not visible to anything that ran: with no signal, the queue-backed
 * screens showed no list and no "no connection" note, while Home and the
 * read-only screens showed both. Their read was behind their write — a
 * token fetch and a queue flush, both talking to a server that was not
 * there.
 */

describe("a screen syncing with no signal", () => {
  it("shows what the phone knows before the queue has finished failing", async () => {
    const order: string[] = [];
    let releaseFlush = () => {};
    const hanging = new Promise<boolean>((resolve) => {
      releaseFlush = () => resolve(false);
    });

    const done = syncOnce({
      refresh: async () => {
        order.push("refresh");
      },
      counters: async () => {
        order.push("counters");
      },
      // The flush that never comes back: an upload with no signal, or a
      // flush already in flight from another screen — `flushQueue`
      // returns the SAME promise to every caller, so one stuck upload
      // used to freeze every queue-backed screen at once.
      flush: () => {
        order.push("flush");
        return hanging;
      },
    });

    // Nothing is resolved yet, and the read has already happened.
    await vi.waitFor(() => expect(order).toContain("flush"));
    expect(order.slice(0, 2)).toEqual(["refresh", "counters"]);

    releaseFlush();
    await done;
  });

  it("does not re-read when nothing went up", async () => {
    const refresh = vi.fn(async () => {});
    await syncOnce({ refresh, counters: async () => {}, flush: async () => false });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("re-reads once the queue has actually sent something", async () => {
    // The one thing the flush earns: the server's rows replacing the
    // optimistic ones the screen drew when it was queued.
    const refresh = vi.fn(async () => {});
    const counters = vi.fn(async () => {});
    await syncOnce({ refresh, counters, flush: async () => true });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(counters).toHaveBeenCalledTimes(2);
  });

  it("still shows the list when the flush throws", async () => {
    // A 401, or any error out of the queue. The list is not its business.
    const refresh = vi.fn(async () => {});
    await syncOnce({
      refresh,
      counters: async () => {},
      flush: async () => {
        throw new Error("401");
      },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("still flushes when the refresh throws", async () => {
    const flush = vi.fn(async () => false);
    await syncOnce({
      refresh: async () => {
        throw new Error("the list blew up");
      },
      counters: async () => {},
      flush,
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
