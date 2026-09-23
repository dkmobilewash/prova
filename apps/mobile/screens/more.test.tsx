import { beforeEach, describe, expect, it } from "vitest";
import { deviceStore, goOffline } from "./setup";
import { mount } from "./render";

/**
 * More — the account, the outbox row with its count, the reminder, and
 * the exit. The queue is the REAL one (AsyncStorage-backed), because the
 * count the row shows is the thing that must not drift from the outbox
 * screen's own number.
 */

beforeEach(async () => {
  deviceStore.clear();
  await goOffline();
});

async function open() {
  const { default: More } = await import("@/app/(tabs)/settings");
  return mount(<More />);
}

describe("More", () => {
  it("shows the account, the queue row and the way out", async () => {
    const screen = await open();
    const text = screen.text();
    expect(text).toContain("Waiting to send");
    expect(text).toContain("Everything has reached the office");
    expect(text).toContain("Remind me about unsent work");
    expect(text).toContain("Sign out");
    screen.unmount();
  });

  it("counts what the phone is still holding, in the row that leads to it", async () => {
    deviceStore.set(
      "prova.field-queue",
      JSON.stringify([
        {
          opId: "op_1",
          type: "time:create",
          jobId: "job_1",
          clientOperationId: "c_1",
          date: "2026-09-18",
          hours: "8",
          payType: "REGULAR",
          queuedAt: "2026-09-18T23:00:00.000Z",
          attempts: 0,
        },
      ]),
    );

    const screen = await open();
    expect(screen.text()).toContain("1 waiting");
    screen.unmount();
  });
});
