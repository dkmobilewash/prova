import { describe, expect, it } from "vitest";
import { planMeasuredWallRun, WALL_TYPE_GONE, type WallTypeFacts } from "./measured-wall-run";

/**
 * Whether a measured run can be posted against a wall type — issue #515.
 *
 * WHAT THE ISSUE WAS. Two measurement paths into the estimate, two behaviours.
 * A wall run created on the Wall types page arrives complete: price, budgeted
 * cost, craft, catalog link, production rate and (since #513) cost category. A
 * plan takeoff arrived carrying description, unit and quantity — so the newest
 * and most impressive way to get quantities into a bid was also the one that
 * dropped you back into hand-pricing every row, while the path that needs no
 * PDF at all arrived priced.
 *
 * THE DECISION IS PURE so the refusals can be read without a database, which is
 * the point: every one of them is a sentence an estimator has to act on, and
 * production redacts a thrown Server Action message to a digest. A refusal that
 * reads perfectly in `next dev` reaches a real estimator as a dead button.
 *
 * `lib/actions/takeoff.wallRun` is the thin part — two reads and a transaction —
 * and is not tested here: `FakeDb` matches a `where` by strict per-key equality,
 * so it cannot express the `{ id: { in: ids } }` and nested-relation filters
 * that action opens with. Rather than build a fake that behaves differently from
 * Postgres and then trust it, the decision moved here and the orchestration is
 * what the click-list walks.
 */

const A1: WallTypeFacts = { code: "A1", defaultHeightFt: 9, sides: 2 };

describe("a wall type that cannot price anything is refused", () => {
  it("names the type and both ways out", () => {
    // THE CASE MOST WORTH A SENTENCE. A type with no components produces no
    // schedule lines, so this would record a wall run and change no number on
    // the bid — a takeoff that looks posted and did nothing. Worse than the
    // bare quantities it replaced, which at least carried the measurement.
    const plan = planMeasuredWallRun({ wallType: A1, layerCount: 0, typedHeightFt: null, label: "Corridor" });
    expect(plan.ok).toBe(false);
    const error = plan.ok === false ? plan.error : "";
    expect(error, "the estimator has to know WHICH type").toContain("A1");
    expect(error).toMatch(/no layers/);
    expect(error, "a refusal names the way out").toMatch(/Wall types page/);
    expect(error, "and the other way out").toMatch(/as quantities/);
  });

  it("is refused before the height is even considered", () => {
    // Order matters for the sentence somebody reads: a layerless type with no
    // height should complain about the layers, which is the thing that makes
    // the whole post pointless, not about the height.
    const plan = planMeasuredWallRun({
      wallType: { code: "A1", defaultHeightFt: null, sides: 2 },
      layerCount: 0,
      typedHeightFt: null,
      label: "Corridor",
    });
    expect(plan.ok === false && plan.error).toMatch(/no layers/);
  });
});

describe("whose height a measured run uses", () => {
  it("takes the wall type's default when nobody typed one", () => {
    const plan = planMeasuredWallRun({ wallType: A1, layerCount: 3, typedHeightFt: null, label: "Corridor" });
    expect(plan).toMatchObject({ ok: true, heightFt: 9 });
  });

  it("lets a typed height win, because WallRun.heightFt is per run", () => {
    // The column is per-run precisely so one measured run can differ from the
    // type's default without editing the type for every other job.
    const plan = planMeasuredWallRun({ wallType: A1, layerCount: 3, typedHeightFt: 12.5, label: "Corridor" });
    expect(plan).toMatchObject({ ok: true, heightFt: 12.5 });
  });

  it("refuses when neither carries one, and says a drawing does not", () => {
    // A drawing carries the run, not the height — that is the whole reason the
    // bridge exists. With no default on the type there is nothing to fall back
    // to, and the refusal should say why rather than just "height required".
    const plan = planMeasuredWallRun({
      wallType: { code: "B2", defaultHeightFt: null, sides: 2 },
      layerCount: 3,
      typedHeightFt: null,
      label: "Corridor",
    });
    expect(plan.ok).toBe(false);
    const error = plan.ok === false ? plan.error : "";
    expect(error).toContain("B2");
    expect(error).toMatch(/no default height/);
    expect(error).toMatch(/drawing does not carry one/);
  });

  it("refuses a height of zero rather than building a wall with no area", () => {
    const plan = planMeasuredWallRun({
      wallType: { code: "A1", defaultHeightFt: 0, sides: 2 },
      layerCount: 3,
      typedHeightFt: null,
      label: "Corridor",
    });
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.error).toMatch(/more than zero/);
  });
});

describe("what the run is called, and how it is boarded", () => {
  it("uses what the estimator called the selection", () => {
    const plan = planMeasuredWallRun({ wallType: A1, layerCount: 3, typedHeightFt: null, label: "Level 3 corridor" });
    expect(plan).toMatchObject({ ok: true, label: "Level 3 corridor" });
  });

  it("falls back to the type's code rather than leaving a run nameless", () => {
    // A blank label is common — the selection is obvious on screen and nobody
    // types a name. An unnamed row on the wall schedule is not.
    for (const label of ["", "   "]) {
      expect(planMeasuredWallRun({ wallType: A1, layerCount: 3, typedHeightFt: null, label })).toMatchObject({
        ok: true,
        label: "A1",
      });
    }
  });

  it("carries the type's sides, and narrows anything else to two", () => {
    // The schema allows any Int; the schedule only means one or two, and a
    // stored 3 must not reach it as 3.
    expect(planMeasuredWallRun({ wallType: { ...A1, sides: 1 }, layerCount: 3, typedHeightFt: null, label: "x" })).toMatchObject({ sides: 1 });
    expect(planMeasuredWallRun({ wallType: { ...A1, sides: 2 }, layerCount: 3, typedHeightFt: null, label: "x" })).toMatchObject({ sides: 2 });
    expect(planMeasuredWallRun({ wallType: { ...A1, sides: 7 }, layerCount: 3, typedHeightFt: null, label: "x" })).toMatchObject({ sides: 2 });
  });
});

describe("the lookup refusal", () => {
  it("is a sentence with a way out, like every other one", () => {
    // Not returned by the planner — the caller that did the lookup returns it —
    // but it lives beside them so the wording cannot drift apart.
    expect(WALL_TYPE_GONE).toMatch(/isn't on your account/);
    expect(WALL_TYPE_GONE).toMatch(/Reload/);
  });
});
