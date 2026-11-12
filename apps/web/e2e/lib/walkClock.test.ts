import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WalkClock } from "./walkClock";

const sleep = () => Promise.resolve();

describe("a walk step's seconds, as a person spends them", () => {
  it("a look that never finds its target is the walk's; one that finds it is real", async () => {
    const clock = new WalkClock();
    expect(await clock.look(async () => false, 20_000)).toBe(false);
    expect(await clock.look(async () => true, 20_000)).toBe(true);
    // 25.9 s on the wall clock, 20 s of it looking for a pairing bar that never came (Totem Lake).
    expect(clock.personSeconds(25_900)).toBe(5.9);
  });

  it("pauses and waits that ran out are the walk's; a new step starts at zero", async () => {
    const clock = new WalkClock();
    await clock.pause(sleep, 3000);
    clock.gaveUp(30_000);
    expect(clock.walk).toBe(33_000);
    expect(clock.personSeconds(20_000)).toBe(0);
    clock.reset();
    expect(clock.personSeconds(1500)).toBe(1.5);
  });
});

/**
 * The census that keeps the flow walk's numbers true: every fixed wait in it goes through `pause`
 * (the walk's) or `workWait` (work a person waits on), never a bare `waitForTimeout`, which the step
 * clock cannot tell from the app being slow. Code only: a comment may name the call.
 */
describe("the flow walk waits only through the clock", () => {
  const source = readFileSync(new URL("../local/new-customer-walk.local.spec.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("has no bare waitForTimeout outside the two helpers", () => {
    const bare = code.split("\n").filter((line) => /\.waitForTimeout\(/.test(line) && !/function (?:pause|workWait)\b|\/\/ helper/.test(line));
    expect(bare).toEqual([]);
  });

  it("times each step with the clock, and its absence checks through it", () => {
    expect(code).toMatch(/clock\.personSeconds\(/);
    expect(code).toMatch(/clock\.look\(/);
  });
});
