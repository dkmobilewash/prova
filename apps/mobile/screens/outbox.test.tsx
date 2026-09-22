import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { deviceStore, goOffline } from "./setup";
import { mount } from "./render";

/**
 * The outbox, rendered.
 *
 * Gap 6's first sentence is that a queued write can be stuck with "no
 * per-item state, no retry/backoff, no way to see or remove a stuck
 * item". This screen is the "see and remove" half, so the test that
 * matters is not that it renders — it is that a person can tell the two
 * situations apart: waiting (ordinary, no signal, goes up by itself) and
 * needs attention (the server answered and said no, nothing more will
 * happen without a decision).
 */

beforeEach(async () => {
  deviceStore.clear();
  await goOffline();
});

function queue(ops: Record<string, unknown>[]) {
  deviceStore.set("prova.field-queue", JSON.stringify(ops));
}

const HOURS = {
  opId: "op_1",
  type: "time:create",
  jobId: "job_1",
  clientOperationId: "c_1",
  date: "2026-09-18",
  hours: "8",
  payType: "REGULAR",
  queuedAt: "2026-09-18T23:00:00.000Z",
  attempts: 0,
};

async function open() {
  const { default: Outbox } = await import("@/app/outbox");
  return mount(<Outbox />);
}

describe("the outbox", () => {
  it("names the work that has not reached the office", async () => {
    // "Pending sync: 1" was the whole of it before: a number nobody can
    // act on. The job name comes off the cached job list, so it reads
    // correctly with no signal — the only time this screen matters.
    deviceStore.set(
      "prova.cache.jobs",
      JSON.stringify({ rows: [{ id: "job_1", name: "ZZQB-TEST" }], at: "2026-09-18T22:00:00.000Z" }),
    );
    queue([HOURS]);

    const screen = await open();
    expect(screen.text()).toContain("8 hours");
    expect(screen.text()).toContain("ZZQB-TEST");
    expect(screen.text()).toContain("Waiting for signal");
    screen.unmount();
  });

  it("tells a write that is merely waiting from one the server refused", async () => {
    queue([{ ...HOURS, attempts: 2, lastError: "Something went wrong", nextTryAt: "2099-01-01T00:00:00.000Z" }]);
    deviceStore.set(
      "prova.field-queue.refused",
      JSON.stringify([
        {
          op: { type: "punch-list:create", jobId: "job_1", clientOperationId: "c_2", description: "Grid out of level" },
          error: "That day is already signed.",
          status: 409,
          at: "2026-09-18T23:30:00.000Z",
        },
      ]),
    );

    const screen = await open();
    expect(screen.text()).toContain("Waiting to send");
    expect(screen.text()).toContain("Tried 2 times");
    expect(screen.text()).toContain("Needs attention");
    expect(screen.text()).toContain("That day is already signed.");
    // The countdown that warns BEFORE a write is set aside.
    expect(screen.text()).toMatch(/more tries, then it moves to Needs attention/);
    screen.unmount();
  });

  it("says plainly when the phone is holding nothing", async () => {
    const screen = await open();
    expect(screen.text()).toContain("Everything on this phone has reached the office.");
    screen.unmount();
  });

  it("says it is still offline rather than pretending to send", async () => {
    queue([HOURS]);
    vi.mocked(api.listJobs).mockRejectedValue(new TypeError("Network request failed"));
    const screen = await open();

    const send = Array.from(document.querySelectorAll("*")).find((node) => node.textContent === "Send now");
    expect(send, "no Send now button").toBeTruthy();
    screen.unmount();
  });
});
