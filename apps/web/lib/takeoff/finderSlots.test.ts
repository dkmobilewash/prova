import { describe, expect, it, vi } from "vitest";

vi.mock("@prova/db", () => ({ prisma: {} }));
const { oneFinderSlot, hurryFinder } = await import("./detectWallsForCalibration");

const gate = () => {
  let open!: () => void;
  const shut = new Promise<void>((resolve) => (open = resolve));
  return { shut, open };
};

describe("wall finders", () => {
  it("RUN ONE AT A TIME: Confirm on 35 sheets no longer starts 35 finders at once, and every one still runs", async () => {
    let running = 0;
    let most = 0;
    const done: number[] = [];
    await Promise.all(
      Array.from({ length: 35 }, (_, i) =>
        oneFinderSlot(async () => {
          running += 1;
          most = Math.max(most, running);
          await new Promise((resolve) => setTimeout(resolve, 1 + (i % 3)));
          running -= 1;
          done.push(i);
        }),
      ),
    );
    expect(most).toBe(1);
    expect(done).toHaveLength(35);
  });

  it("a finder that throws still frees its slot", async () => {
    await expect(oneFinderSlot(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await oneFinderSlot(async () => "ran")).toBe("ran");
  });

  it("THE SHEET SOMEBODY IS WAITING ON STARTS AT ONCE, beside the running one, and the line goes back to one at a time after", async () => {
    const order: string[] = [];
    let running = 0;
    let most = 0;
    const g = gate();
    const track = (name: string, work: () => Promise<void> = async () => {}) => async () => {
      running += 1;
      most = Math.max(most, running);
      order.push(name);
      await work();
      running -= 1;
    };
    const first = oneFinderSlot(track("plan:1", () => g.shut), "plan:1");
    const queued = Array.from({ length: 6 }, (_, i) => oneFinderSlot(track(`plan:${i + 2}`), `plan:${i + 2}`));
    expect(hurryFinder("plan", 5)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // It ran while plan:1 still holds its slot.
    expect(order).toEqual(["plan:1", "plan:5"]);
    expect(hurryFinder("plan", 99)).toBe(false);
    const urgent = oneFinderSlot(track("urgent"), "plan:50", true);
    g.open();
    await Promise.all([first, ...queued, urgent]);
    expect(order[2]).toBe("urgent");
    expect(order).toHaveLength(8);
    expect(most).toBe(2);
    // And after: one at a time again.
    running = 0;
    most = 0;
    await Promise.all(Array.from({ length: 5 }, (_, i) => oneFinderSlot(track(`after:${i}`, () => new Promise((r) => setTimeout(r, 2))))));
    expect(most).toBe(1);
  });

  it("IS ONE QUEUE FOR THE PROCESS, whichever copy of the module asks (Next bundles each route on its own: ELEVEN03's hurry found nothing)", async () => {
    vi.resetModules();
    const other = await import("./detectWallsForCalibration");
    expect(other.hurryFinder).not.toBe(hurryFinder);
    const order: string[] = [];
    const g = gate();
    const running = oneFinderSlot(() => g.shut, "plan:1");
    const queued = Array.from({ length: 5 }, (_, i) => oneFinderSlot(async () => void order.push(`plan:${i + 2}`), `plan:${i + 2}`));
    // Queued through the first copy, hurried through the second: it runs before plan:1 frees its slot.
    expect(other.hurryFinder("plan", 6)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["plan:6"]);
    g.open();
    await Promise.all([running, ...queued]);
  });
});
