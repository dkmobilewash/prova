import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BID_CAPABILITY, BID_PUBLIC_ROUTES, BID_ROUTES } from "@/components/bid/bidNav";
import { JOB_FUNCTIONS, can, type Capability } from "@/lib/permissions";

/**
 * EVERY C STREAM BID PAGE HAS AN ACCESS DECISION, AND NONE IS LOOSER THAN ITS
 * CRM TWIN.
 *
 * `lib/permissions.test.ts` makes "a new page with no decision" fail — for
 * `app/(app)`. Bid's pages live in `app/bid`, outside that walk, so this is the
 * same census pointed at them (the lesson CLAUDE.md records three times:
 * nothing is missing from a directory you do not walk). It starts from the
 * FILESYSTEM, asserts the size of what it found, and then asks four things of
 * each page:
 *
 *   1. it is in `BID_ROUTES` (or is one of the two public pages) — a page nobody
 *      decided on fails by name;
 *   2. it enforces: its own source calls `requireCapability(BID_CAPABILITY)`, or
 *      it renders a CRM page whose source calls `requireCapability` with the
 *      capability the table records for that twin;
 *   3. Bid is never looser than the twin — for every job function and for the
 *      owner, holding BID_CAPABILITY implies holding what the twin demands;
 *   4. the table has no row for a page that no longer exists.
 *
 * (3) is why the estimate and recap pages may use Bid's one gate
 * (MANAGE_ESTIMATING) where their CRM twin soft-gates on VIEW_JOB_COSTS: every
 * function that holds the first holds the second, and this proves it rather
 * than the comment saying so.
 */

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const BID_APP = join(webRoot, "app", "bid");

/** URL pattern of a page file under app/bid, route groups dropped. */
function routeOf(file: string): string {
  const segments = relative(BID_APP, file)
    .split(sep)
    .slice(0, -1)
    .filter((s) => !/^\(.*\)$/.test(s));
  return "/bid" + (segments.length ? "/" + segments.join("/") : "");
}

function pageFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) pageFiles(full, out);
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

const pages = new Map(pageFiles(BID_APP).map((f) => [routeOf(f), f]));
const decided = new Set([...BID_ROUTES.map((r) => r.route), ...BID_PUBLIC_ROUTES]);

const code = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The CRM page file a Bid page renders, when it is a thin wrapper around one. */
function delegatedCrmPage(source: string): string | null {
  const match = source.match(/from "@\/app\/((?:\(app\)|takeoff)\/[^"]+)"/);
  if (!match) return null;
  const path = join(webRoot, "app", match[1] + ".tsx");
  return existsSync(path) ? path : null;
}

describe("the Bid pages, derived from app/bid", () => {
  it("finds them at all (size first, so an empty walk cannot pass)", () => {
    expect(pages.size).toBeGreaterThanOrEqual(13);
    for (const must of ["/bid", "/bid/bids", "/bid/estimates", "/bid/estimates/[id]/proposal", "/bid/workspace/[id]"]) {
      expect(pages.has(must), must).toBe(true);
    }
  });

  it("has a recorded access decision for every page (absence is not a decision)", () => {
    const undecided = [...pages.keys()].filter((route) => !decided.has(route));
    expect(undecided, "a Bid page nobody decided who may reach — add it to BID_ROUTES in components/bid/bidNav.ts").toEqual([]);
  });

  it("records no decision for a page that is gone", () => {
    const orphans = [...decided].filter((route) => !pages.has(route));
    expect(orphans).toEqual([]);
  });

  it("lists each route once", () => {
    const routes = BID_ROUTES.map((r) => r.route);
    expect(new Set(routes).size).toBe(routes.length);
  });
});

describe("each signed-in Bid page enforces its decision", () => {
  it("calls requireCapability(BID_CAPABILITY), directly or through the CRM page it renders", () => {
    const failures: string[] = [];
    for (const row of BID_ROUTES) {
      const file = pages.get(row.route);
      if (!file) continue; // reported above
      const source = code(file);
      if (source.includes("requireCapability(BID_CAPABILITY)")) continue;
      // `/bid/estimates/[id]` only redirects: its LAYOUT is the gate, and the page
      // it redirects to enforces for itself. Anything that renders no data needs
      // no capability of its own, but it must be a bare redirect — not a screen.
      if (row.route === "/bid/estimates/[id]") {
        if (!source.includes("redirect(") || /<[A-Za-z]/.test(source)) failures.push(`${row.route}: not a bare redirect`);
        continue;
      }
      const crm = delegatedCrmPage(source);
      if (!crm) {
        failures.push(`${row.route}: neither calls requireCapability(BID_CAPABILITY) nor renders a CRM page`);
        continue;
      }
      if (row.twinCapability === null || !code(crm).includes(`requireCapability("${row.twinCapability}")`)) {
        failures.push(`${row.route}: renders ${relative(webRoot, crm)}, which does not call requireCapability("${row.twinCapability}")`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("the signed-in shell and the estimate layout gate on BID_CAPABILITY too", () => {
    for (const layout of [join(BID_APP, "(signed-in)", "layout.tsx"), join(BID_APP, "(signed-in)", "estimates", "[id]", "layout.tsx")]) {
      expect(code(layout), relative(webRoot, layout)).toMatch(/BID_CAPABILITY/);
    }
  });
});

describe("Bid is never looser than the CRM twin", () => {
  it("Bid's one gate is the estimating capability", () => {
    expect(BID_CAPABILITY).toBe("MANAGE_ESTIMATING");
  });

  const principals = [
    { label: "owner", role: "OWNER", jobFunction: null as string | null },
    { label: "member, no function", role: "MEMBER", jobFunction: null as string | null },
    ...JOB_FUNCTIONS.map((fn) => ({ label: fn, role: "MEMBER", jobFunction: fn as string | null })),
  ];

  it("for every function: holding the Bid gate implies holding what each twin demands", () => {
    const looser: string[] = [];
    for (const row of BID_ROUTES) {
      if (row.twinCapability === null) continue;
      for (const person of principals) {
        if (can(person, BID_CAPABILITY) && !can(person, row.twinCapability as Capability)) {
          looser.push(`${row.route} admits ${person.label}, but its twin ${row.twin} needs ${row.twinCapability}`);
        }
      }
    }
    expect(looser).toEqual([]);
  });

  it("and the check can fail (a twin Bid's gate does NOT cover is caught)", () => {
    // MANAGE_BILLING is held by PROJECT_MANAGER (who holds MANAGE_ESTIMATING)
    // but not by ESTIMATOR (who does) — so a row demanding it must be reported.
    const estimator = { role: "MEMBER", jobFunction: "ESTIMATOR" };
    expect(can(estimator, BID_CAPABILITY) && !can(estimator, "MANAGE_BILLING")).toBe(true);
  });

  it("the twins' capabilities match the CRM's own tables", async () => {
    const { ROUTE_CAPABILITY } = await import("@/lib/permissions");
    const checks: [string, Capability][] = [
      ["/bids", "MANAGE_ESTIMATING"],
      ["/wall-types", "MANAGE_ESTIMATING"],
      ["/catalog", "MANAGE_ESTIMATING"],
      ["/proposals", "MANAGE_ESTIMATING"],
    ];
    for (const [twin, capability] of checks) {
      expect(ROUTE_CAPABILITY[twin], twin).toBe(capability);
      const row = BID_ROUTES.find((r) => r.twin === twin);
      expect(row?.twinCapability, `BID_ROUTES row for ${twin}`).toBe(capability);
    }
  });
});
