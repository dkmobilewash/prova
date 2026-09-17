import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BANDS,
  CONTRACT_EFFECT,
  STATUS_LABEL,
  STATUS_STYLE,
  VALUE_QUALIFIER,
  bandForStatus,
  groupIntoBands,
} from "@/components/changeOrderStates";

/**
 * The reviewer's question was "is this for executed change orders or for
 * pending change orders?", and the answer had better not be "whichever the
 * band list happens to cover this week". Two failures are possible here and
 * only one of them looks like a failure:
 *
 *   - a state filed in the WRONG band — an executed heading over money the
 *     GC has not agreed to;
 *   - a state in NO band — a change order that does not render at all,
 *     which is worse, and which every "group the list by category" change
 *     in this repo is one enum member away from.
 *
 * So the enum is read out of the schema rather than typed out here. A hand
 * copy notices nothing: adding a member to ChangeOrderStatus does not touch
 * this file, so the check would stay green through exactly the change it
 * exists to catch (the same defect issue #150 found in safetyLabels).
 */
const SCHEMA_DIR = join(__dirname, "../../../packages/db/prisma/schema");

function enumMembers(name: string): string[] {
  const text = readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".prisma"))
    .map((f) => readFileSync(join(SCHEMA_DIR, f), "utf8"))
    .join("\n");
  const block = new RegExp(`^enum\\s+${name}\\s*\\{([^}]*)\\}`, "m").exec(text);
  if (!block) return [];
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"))
    .map((line) => line.split(/\s+/)[0]);
}

const SCHEMA_STATUSES = enumMembers("ChangeOrderStatus");

type Row = { id: string; status: string };
const row = (id: string, status: string): Row => ({ id, status });

describe("the statuses this screen claims to cover", () => {
  it("finds the enum it is guarding", () => {
    // Without this the loops below iterate an empty list and every
    // assertion in this file passes while checking nothing. A pattern that
    // matches nothing is never missing anything.
    expect(SCHEMA_STATUSES).toEqual(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "VOID"]);
  });

  it("puts every schema status in exactly one band", () => {
    for (const status of SCHEMA_STATUSES) {
      const claiming = BANDS.filter((band) =>
        (band.statuses as readonly string[]).includes(status),
      );
      expect(claiming, `${status} should be claimed by exactly one band`).toHaveLength(1);
    }
  });

  it("claims no status the schema cannot store", () => {
    for (const band of BANDS) {
      for (const status of band.statuses) {
        expect(SCHEMA_STATUSES).toContain(status);
      }
    }
  });

  it("labels, styles, effects and qualifiers cover every schema status", () => {
    // Four maps keyed by status. A missing key renders `undefined` — an
    // empty chip, or worse, a blank where the sentence saying whether the
    // money is real should be.
    for (const status of SCHEMA_STATUSES) {
      expect(STATUS_LABEL, status).toHaveProperty(status);
      expect(STATUS_STYLE, status).toHaveProperty(status);
      expect(CONTRACT_EFFECT, status).toHaveProperty(status);
      expect(VALUE_QUALIFIER, status).toHaveProperty(status);
    }
    expect(Object.keys(STATUS_LABEL).sort()).toEqual([...SCHEMA_STATUSES].sort());
    expect(Object.keys(CONTRACT_EFFECT).sort()).toEqual([...SCHEMA_STATUSES].sort());
  });
});

describe("the pending / executed distinction, which is the whole point", () => {
  it("files SUBMITTED as pending and APPROVED as executed, never together", () => {
    const pending = bandForStatus("SUBMITTED");
    const executed = bandForStatus("APPROVED");
    expect(pending?.key).toBe("PENDING");
    expect(executed?.key).toBe("EXECUTED");
    expect(pending?.key).not.toBe(executed?.key);
  });

  it("says PCO on the pending band and executed on the executed one", () => {
    // The industry's own words, which is what was asked for. "Pending" and
    // "approved" alone are what the screen already said and what the
    // reviewer could not read off it.
    expect(bandForStatus("SUBMITTED")?.heading).toContain("PCO");
    expect(bandForStatus("SUBMITTED")?.alsoCalled).toContain("change order request");
    expect(bandForStatus("APPROVED")?.heading.toLowerCase()).toContain("executed");
  });

  it("says the contract sum has moved only for the executed one", () => {
    // Not a computed figure — a claim about a figure that already exists.
    // APPROVED writes its proposals onto JobLineItem; nothing else does.
    expect(CONTRACT_EFFECT.APPROVED).toMatch(/\bIn the contract sum\b/);
    expect(VALUE_QUALIFIER.APPROVED).toBe("in the contract");

    for (const status of ["DRAFT", "SUBMITTED", "REJECTED", "VOID"] as const) {
      expect(CONTRACT_EFFECT[status], status).toMatch(/not (in the contract sum|moved)|unchanged/i);
      expect(VALUE_QUALIFIER[status], status).not.toBe(VALUE_QUALIFIER.APPROVED);
    }
  });
});

describe("groupIntoBands", () => {
  it("keeps a VOID and a REJECTED change order on screen", () => {
    // The outcome the reviewer named — "argued off or withdrawn" — and the
    // one a grouped list is most likely to drop, because nobody misses a
    // heading that never appears.
    const { groups, unbanded } = groupIntoBands([row("a", "VOID"), row("b", "REJECTED")]);
    expect(unbanded).toEqual([]);
    const rendered = groups.flatMap((g) => g.items.map((i) => i.id));
    expect(rendered).toContain("a");
    expect(rendered).toContain("b");
  });

  it("keeps rejected and withdrawn distinguishable inside that band", () => {
    // Same band, because a PM wants both for the same reason. Different
    // chip, because "the GC said no" and "we stopped asking" are different
    // facts in a dispute.
    expect(bandForStatus("REJECTED")?.key).toBe(bandForStatus("VOID")?.key);
    expect(STATUS_LABEL.REJECTED).not.toBe(STATUS_LABEL.VOID);
    expect(STATUS_STYLE.REJECTED).not.toBe(STATUS_STYLE.VOID);
  });

  it("gives the withdrawn chip a ground of its own", () => {
    // It used to be `bg-surface`, which is the card's own colour — a chip
    // with no chip. The state the reviewer asked to keep visible was the
    // least visible thing in the section.
    expect(STATUS_STYLE.VOID).not.toContain("bg-surface");
    expect(STATUS_STYLE.VOID).toContain("bg-tag-slate");
  });

  it("loses nothing: every input comes back in a band or in unbanded", () => {
    const input = [
      row("1", "DRAFT"),
      row("2", "SUBMITTED"),
      row("3", "APPROVED"),
      row("4", "REJECTED"),
      row("5", "VOID"),
      row("6", "SUBMITTED"),
    ];
    const { groups, unbanded } = groupIntoBands(input);
    const out = [...groups.flatMap((g) => g.items), ...unbanded];
    expect(out).toHaveLength(input.length);
    expect(out.map((i) => i.id).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("returns a state no band claims instead of swallowing it", () => {
    // A future enum member must reach the screen as unclassified, never
    // vanish. This is the only assertion here that a hand-written status
    // list could not have made.
    const { groups, unbanded } = groupIntoBands([row("x", "SOMETHING_NEW"), row("y", "APPROVED")]);
    expect(unbanded.map((i) => i.id)).toEqual(["x"]);
    expect(groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(["y"]);
    expect(bandForStatus("SOMETHING_NEW")).toBeNull();
  });

  it("drops empty bands and keeps the rest in lifecycle order", () => {
    const { groups } = groupIntoBands([row("a", "VOID"), row("b", "SUBMITTED")]);
    expect(groups.map((g) => g.band.key)).toEqual(["PENDING", "CLOSED"]);
  });

  it("keeps input order inside a band", () => {
    // The page loads change orders by number ascending, so CO #2 must not
    // appear above CO #1 because of how the buckets were filled.
    const { groups } = groupIntoBands([
      row("co1", "SUBMITTED"),
      row("co2", "APPROVED"),
      row("co3", "SUBMITTED"),
    ]);
    const pending = groups.find((g) => g.band.key === "PENDING");
    expect(pending?.items.map((i) => i.id)).toEqual(["co1", "co3"]);
  });

  it("is empty for no change orders", () => {
    expect(groupIntoBands([])).toEqual({ groups: [], unbanded: [] });
  });
});

describe("the section renders every band it is handed", () => {
  /**
   * A source scan, and a narrow one on purpose. The grouping above is
   * testable in isolation; what it cannot see is a component that computes
   * bands and then renders only some of them — which is how "the list is
   * grouped now" and "a withdrawn CO disappeared" end up both true.
   *
   * Counted against a literal so a renamed symbol fails loudly here rather
   * than matching nothing and passing.
   */
  const source = readFileSync(join(__dirname, "ChangeOrders.tsx"), "utf8");

  it("maps over the grouped bands and over the unbanded leftovers", () => {
    expect(source).toContain("groupIntoBands(changeOrders)");
    expect(source).toContain("groups.map(");
    expect(source).toContain("unbanded.map(");
  });

  it("has no status filter left in the list render", () => {
    // `changeOrders.filter(...)` survives only for the pending COUNT in the
    // header. If a second one appears, something is being hidden.
    const filters = source.match(/changeOrders\.filter\(/g) ?? [];
    expect(filters).toHaveLength(1);
  });

  it("states the contract effect on the row, not only in the band heading", () => {
    expect(source).toContain("CONTRACT_EFFECT[co.status]");
    expect(source).toContain("VALUE_QUALIFIER[co.status]");
  });
});
