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

  it("THE SHEET SOMEBODY IS WAITING ON JUMPS THE LINE, and an urgent one (a whole-set run's sheet) goes first", async () => {
    const order: string[] = [];
    const g = gate();
    const running = oneFinderSlot(() => g.shut, "plan:1");
    const queued = Array.from({ length: 10 }, (_, i) => oneFinderSlot(async () => void order.push(`plan:${i + 2}`), `plan:${i + 2}`));
    expect(hurryFinder("plan", 9)).toBe(true);
    expect(hurryFinder("plan", 99)).toBe(false);
    const urgent = oneFinderSlot(async () => void order.push("urgent"), "plan:50", true);
    g.open();
    await Promise.all([running, ...queued, urgent]);
    expect(order.slice(0, 2)).toEqual(["urgent", "plan:9"]);
    expect(order).toHaveLength(11);
  });

  it("IS ONE QUEUE FOR THE PROCESS, whichever copy of the module asks (Next bundles each route on its own: ELEVEN03's hurry found nothing)", async () => {
    vi.resetModules();
    const other = await import("./detectWallsForCalibration");
    expect(other.hurryFinder).not.toBe(hurryFinder);
    const order: string[] = [];
    const g = gate();
    const running = oneFinderSlot(() => g.shut, "plan:1");
    const queued = Array.from({ length: 5 }, (_, i) => oneFinderSlot(async () => void order.push(`plan:${i + 2}`), `plan:${i + 2}`));
    // Queued through the first copy, hurried through the second.
    expect(other.hurryFinder("plan", 6)).toBe(true);
    g.open();
    await Promise.all([running, ...queued]);
    expect(order[0]).toBe("plan:6");
  });
});
