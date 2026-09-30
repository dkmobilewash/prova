/**
 * EVERY ALERT BUILT REACHES THE LIST — a census over the ORDER of two
 * statements, which is the only thing that was ever wrong.
 *
 * On main, `loadAlerts` computed
 *
 *     const permitted = visibleToPrincipal(alerts, …)
 *
 * and then pushed four more kinds onto `alerts` afterwards. `visible-
 * ToPrincipal` returns a NEW array, so that assignment is a SNAPSHOT: the
 * late delivery, the aging punch item, the equipment still out on a finished
 * job and the delay the GC was never told about were all built, all
 * capability-checked, and never returned. The bell had never shown one.
 *
 * NOTHING FAILED, AND NOTHING COULD. The builders were called. Their unit
 * tests passed — they are pure functions and were given inputs directly. The
 * capability map was exhaustive. `itemLinksCensus.test.ts` found their hrefs
 * and checked every one was reachable. Every instrument in this repo was
 * pointed at whether the alerts were CORRECT, and the defect was whether they
 * were RETURNED. CLAUDE.md's newest entry names that exact shape: nothing is
 * ever missing from a question nobody is asking.
 *
 * So this file asks the two questions nobody was asking.
 *
 * ONE: is every builder `alerts-query.ts` imports actually CALLED. That is
 * the "written, documented, and never called" shape, which this repo has
 * found three times in a day.
 *
 * TWO: does every call happen BEFORE the snapshot. This is the bug above,
 * and it is a line-number comparison rather than anything clever, because
 * the bug was not clever.
 *
 * HOW THIS KEEPS ITSELF HONEST, since a census that sees nothing passes
 * everything:
 *
 *   - the builder set is derived from `alerts.ts`'s own exports, and asserted
 *     non-trivial by COUNT and by two named sentinels — one old kind and one
 *     new — so a regex that stops matching fails by name instead of
 *     shrinking to an empty set that satisfies every assertion below it;
 *   - the snapshot anchor must match EXACTLY ONCE. Zero matches would make
 *     every ordering comparison vacuous, and two would mean the function was
 *     restructured into something this file no longer understands;
 *   - comments are stripped before any structural read. `alerts-query.ts`
 *     now carries a long comment ABOUT `visibleToPrincipal` sitting last, and
 *     a raw-text scan would find the anchor inside its own explanation. That
 *     is #185's shape — a census disarmed by a comment quoting its pattern.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Block and line comments out, string contents left alone. Crude on
 * purpose: it only has to stop a comment from being read as code, and every
 * pattern below anchors on a line's leading whitespace, so a blanked comment
 * line cannot match one. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, lead: string) => lead);
}

const ALERTS = stripComments(read("./alerts.ts"));
const QUERY = stripComments(read("./alerts-query.ts"));

/** Not a builder: it partitions what the builders produced. Named with its
 * reason rather than pattern-excluded, so the exception cannot grow. */
const NOT_A_BUILDER = new Set(["partitionAlerts"]);

/** Every `export function …Alerts(` in alerts.ts. */
function declaredBuilders(): string[] {
  return [...ALERTS.matchAll(/^export function (\w+Alerts)\(/gm)]
    .map((m) => m[1])
    .filter((name) => !NOT_A_BUILDER.has(name));
}

/** The names alerts-query.ts imports from "@/lib/alerts", which is the set it
 * is answerable for. A builder it does not import is some other file's job. */
function importedFromAlerts(): string[] {
  const block = /import \{([\s\S]*?)\} from "@\/lib\/alerts";/.exec(QUERY);
  if (!block) return [];
  return block[1]
    .split(",")
    .map((part) => part.trim())
    // `type PartitionedAlerts` is a TYPE and ends in "Alerts" — dropped
    // here rather than named in NOT_A_BUILDER, because the reason is
    // categorical: a type is never called, so a type in this set would make
    // the "every builder is called" assertion permanently red.
    .filter((part) => !part.startsWith("type "))
    .filter((name) => /^\w+Alerts$/.test(name))
    .filter((name) => !NOT_A_BUILDER.has(name));
}

const lines = QUERY.split("\n");
const lineOf = (re: RegExp) => lines.flatMap((line, i) => (re.test(line) ? [i + 1] : []));

describe("the alert builders alerts-query.ts imports", () => {
  const declared = declaredBuilders();
  const imported = importedFromAlerts();

  it("were found at all, by count and by name", () => {
    // The size assertion, first, against alerts.ts's own exports. A floor
    // rather than an equality so adding a kind is not a failing build — the
    // named sentinels are what stop the floor being met by coincidence.
    expect(declared.length, `builders parsed out of alerts.ts: ${declared.join(", ")}`)
      .toBeGreaterThanOrEqual(14);
    expect(declared).toEqual(
      expect.arrayContaining(["backchargeAlerts", "materialDeliveryAlerts", "das140Alerts"]),
    );
    expect(imported.length).toBeGreaterThanOrEqual(10);
    expect(imported.every((name) => declared.includes(name))).toBe(true);
  });

  it("are every one of them called", () => {
    const uncalled = imported.filter(
      (name) => !new RegExp(`\\.\\.\\.${name}\\(|[^\\w.]${name}\\(`).test(QUERY),
    );
    expect(
      uncalled,
      "alerts-query.ts imports these builders and never calls one. An alert " +
        "kind nobody builds is dead code that typechecks — the shape CLAUDE.md " +
        "records three of in a single day.",
    ).toEqual([]);
  });
});

describe("visibleToPrincipal runs after the last push, not in the middle of them", () => {
  const anchors = lineOf(/^\s*const permitted = visibleToPrincipal\(/);
  const pushes = lineOf(/^\s*alerts\.push\(/);

  it("found the snapshot exactly once and found the pushes", () => {
    // Scope and size before any comparison. Zero anchors makes every
    // ordering check below vacuously true, which is precisely how the bug
    // this file exists for would come back.
    expect(anchors, "the `const permitted = visibleToPrincipal(` line").toHaveLength(1);
    expect(pushes.length, "alerts.push( call sites").toBeGreaterThanOrEqual(12);
  });

  it("has no push after it", () => {
    const [snapshot] = anchors;
    const stranded = pushes.filter((line) => line > snapshot);
    expect(
      stranded,
      `alerts-query.ts pushes alerts at line(s) ${stranded.join(", ")}, AFTER ` +
        `visibleToPrincipal snapshots the array at line ${snapshot}. Those ` +
        "alerts are built, gated, and thrown away — exactly what shipped on " +
        "main for the four field kinds. Move the snapshot below the last push.",
    ).toEqual([]);
  });

  it("is the last statement before the return, so a new push cannot land under it", () => {
    const [snapshot] = anchors;
    const ret = lineOf(/^\s*return partitionAlerts\(/);
    expect(ret).toHaveLength(1);
    // Only blank lines between them. Anything else is somewhere a future
    // push could be appended without this file noticing the gap.
    const between = lines.slice(snapshot, ret[0] - 1).filter((line) => line.trim() !== "");
    expect(
      between,
      "Keep visibleToPrincipal immediately before the return. Code between " +
        "them is a landing spot for the next push, which is how this bug got " +
        "in the first time.",
    ).toEqual([]);
  });
});
