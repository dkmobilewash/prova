import { describe, expect, it, vi } from "vitest";

vi.mock("@prova/db", () => ({ prisma: {} }));
const { oneFinderSlot } = await import("./detectWallsForCalibration");

describe("wall finders started after a scale save", () => {
  it("RUN TWO AT A TIME: Confirm on 35 sheets no longer starts 35 finders at once, and every one still runs", async () => {
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
    expect(most).toBe(2);
    expect(done).toHaveLength(35);
  });

  it("a finder that throws still frees its slot", async () => {
    await expect(oneFinderSlot(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(oneFinderSlot(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await oneFinderSlot(async () => "ran")).toBe("ran");
  });
});
