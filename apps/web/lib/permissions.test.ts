import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  JOB_FUNCTIONS,
  ROUTE_CAPABILITY,
  can,
  canReach,
  capabilitiesFor,
  isRestricted,
  type Capability,
} from "./permissions";

const owner = (jobFunction: string | null = null) => ({ role: "OWNER", jobFunction });
const member = (jobFunction: string | null = null) => ({ role: "MEMBER", jobFunction });

describe("an owner", () => {
  it("holds every capability, whatever their job function says", () => {
    // The rule that stops this feature being able to lock someone out of
    // their own company. On a single-owner account — most of them — there
    // is nobody else to undo it.
    for (const fn of [null, ...JOB_FUNCTIONS]) {
      expect(capabilitiesFor(owner(fn)).size).toBe(CAPABILITIES.length);
    }
  });

  it("is never reported as restricted", () => {
    expect(isRestricted(owner("FIELD"))).toBe(false);
  });
});

describe("a member with no job function set", () => {
  it("keeps exactly the access every member has always had", () => {
    // The migration-safety rule. This column arrives null on every
    // existing row, and nobody may lose anything on the day it ships.
    expect(capabilitiesFor(member(null)).size).toBe(CAPABILITIES.length);
    expect(isRestricted(member(null))).toBe(false);
  });

  it("falls back to that same access for a function this build doesn't know", () => {
    // Far more likely a newer enum member than an attack, and locking a
    // real person out on a string comparison is the worse outcome.
    expect(capabilitiesFor(member("SOMETHING_NEWER")).size).toBe(CAPABILITIES.length);
  });
});

describe("the field tier", () => {
  const foreman = member("FIELD");

  it("keeps what the job needs", () => {
    expect(can(foreman, "MANAGE_FIELD")).toBe(true);
    expect(can(foreman, "MANAGE_JOBS")).toBe(true);
  });

  it("cannot see cost, margin, billing or company money", () => {
    // This is the audit row. If any of these four flips to true, the
    // "field-only access" claim is false.
    expect(can(foreman, "VIEW_JOB_COSTS")).toBe(false);
    expect(can(foreman, "VIEW_COMPANY_FINANCIALS")).toBe(false);
    expect(can(foreman, "MANAGE_BILLING")).toBe(false);
    expect(can(foreman, "MANAGE_ESTIMATING")).toBe(false);
  });

  it("is the narrowest function of them all", () => {
    const sizes = JOB_FUNCTIONS.map((fn) => capabilitiesFor(member(fn)).size);
    expect(Math.min(...sizes)).toBe(capabilitiesFor(foreman).size);
    expect(isRestricted(foreman)).toBe(true);
  });
});

describe("the other functions", () => {
  it("gives an estimator job cost but not billing", () => {
    // You cannot price the next job honestly without knowing what the
    // last one cost; what has been invoiced is not an estimator's
    // business.
    expect(can(member("ESTIMATOR"), "VIEW_JOB_COSTS")).toBe(true);
    expect(can(member("ESTIMATOR"), "MANAGE_BILLING")).toBe(false);
  });

  it("gives a PM billing but not the company's whole book", () => {
    expect(can(member("PROJECT_MANAGER"), "MANAGE_BILLING")).toBe(true);
    expect(can(member("PROJECT_MANAGER"), "VIEW_COMPANY_FINANCIALS")).toBe(false);
  });

  it("gives accounting the money and not the field", () => {
    expect(can(member("ACCOUNTING"), "MANAGE_BILLING")).toBe(true);
    expect(can(member("ACCOUNTING"), "VIEW_COMPANY_FINANCIALS")).toBe(true);
    expect(can(member("ACCOUNTING"), "MANAGE_FIELD")).toBe(false);
  });

  it("gives an executive everything a member can have", () => {
    expect(capabilitiesFor(member("EXECUTIVE")).size).toBe(CAPABILITIES.length);
  });

  it("gives payroll/compliance the paperwork and not the pricing", () => {
    expect(can(member("PAYROLL_COMPLIANCE"), "MANAGE_COMPLIANCE")).toBe(true);
    expect(can(member("PAYROLL_COMPLIANCE"), "MANAGE_ESTIMATING")).toBe(false);
  });
});

describe("canReach", () => {
  it("lets anyone signed in reach a deliberately open route", () => {
    // These three are on the OPEN_ROUTES list below with their reasons.
    expect(canReach(member("FIELD"), "/dashboard")).toBe(true);
    expect(canReach(member("FIELD"), "/alerts")).toBe(true);
    expect(canReach(member("FIELD"), "/schedule")).toBe(true);
  });

  it("keeps a foreman on the routes their job actually is", () => {
    // `/safety` and `/punch-lists` USED to be listed above as examples of
    // open routes, which read as a deliberate decision and was not one:
    // they were absent from ROUTE_CAPABILITY entirely, so canReach()
    // returned true for everybody, including the accounting tier that the
    // test above asserts has no MANAGE_FIELD. The assertion was right
    // about the foreman and wrong about the reason. They are guarded now,
    // and a foreman still reaches them because FIELD holds MANAGE_FIELD —
    // which is the thing worth pinning.
    expect(canReach(member("FIELD"), "/safety")).toBe(true);
    expect(canReach(member("FIELD"), "/punch-lists")).toBe(true);
    expect(canReach(member("FIELD"), "/rfis")).toBe(true);
  });

  it("keeps a foreman off the money routes", () => {
    expect(canReach(member("FIELD"), "/cash-flow")).toBe(false);
    expect(canReach(member("FIELD"), "/backcharges")).toBe(false);
    expect(canReach(member("FIELD"), "/catalog")).toBe(false);
  });

  it("keeps the accounting tier out of the field and the correspondence", () => {
    // The hole this enumeration was built to catch. An ACCOUNTING member
    // holds no MANAGE_FIELD (asserted above) and no MANAGE_JOBS, and
    // safety cases, RFIs and submittals are evidence records.
    expect(canReach(member("ACCOUNTING"), "/safety")).toBe(false);
    expect(canReach(member("ACCOUNTING"), "/punch-lists")).toBe(false);
    expect(canReach(member("ACCOUNTING"), "/equipment")).toBe(false);
    expect(canReach(member("ACCOUNTING"), "/rfis")).toBe(false);
    expect(canReach(member("ACCOUNTING"), "/submittals")).toBe(false);
  });

  it("agrees with can() on every mapped route, for every principal", () => {
    // The nav filter and the page guards read the same map. This is what
    // stops a link being shown to a door that will not open. It says
    // NOTHING about a door left unlisted — see the enumeration below,
    // which is where that claim actually lives.
    for (const [href, capability] of Object.entries(ROUTE_CAPABILITY)) {
      for (const fn of [null, ...JOB_FUNCTIONS]) {
        for (const role of ["OWNER", "MEMBER"]) {
          const user = { role, jobFunction: fn };
          expect(canReach(user, href)).toBe(can(user, capability as Capability));
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Every door the app actually serves
 * ------------------------------------------------------------------ */

/**
 * The check that had to exist before any of the mapping above was worth
 * anything.
 *
 * The previous version of this file iterated `Object.entries(
 * ROUTE_CAPABILITY)` and claimed, in its own comment, to prevent "a door
 * being left unlisted but unguarded". It could not: a route ABSENT from
 * that map contributes no iteration, so the loop is structurally blind to
 * exactly the defect it advertised. `MANAGE_FIELD` and `MANAGE_JOBS`
 * were both defined, both documented by route name, and both mapped to
 * NOTHING — every test in this file passed the whole time, and
 * `/safety`, `/punch-lists`, `/equipment`, `/rfis` and `/submittals`
 * were open to every signed-in person including the accounting tier
 * three tests up assert holds neither capability. Same shape as the dead
 * P2002 guards in #25 and #26: a check that exists and can never fire.
 *
 * So the enumeration starts from the FILESYSTEM — the thing that decides
 * what Next.js actually serves — and not from any hand-written list,
 * which is the artefact that drifted in the first place. Every
 * `page.tsx` under `app/(app)` must land in exactly one of three places,
 * all of them a recorded decision:
 *
 *   ROUTE_CAPABILITY        guarded, and reachable from the nav
 *   PAGE_ONLY_CAPABILITY    guarded, but a dynamic route the nav never
 *                           links by a static href
 *   OPEN_ROUTES             deliberately open, with the reason written
 *                           down here
 *
 * Adding a page without deciding fails this suite by name. That is the
 * whole point: the failure has to be the DEFAULT for a new door, because
 * nobody forgets on purpose.
 */

const APP_DIR = resolve(__dirname, "../app/(app)");

/** Every route Next.js serves under `(app)`, in its route-pattern form —
 * `(group)` folders vanish from the URL, `[id]` folders stay as written
 * so a route can be named unambiguously here. */
function pageRoutes(dir: string, prefix = "", acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const segment = /^\(.*\)$/.test(entry) ? "" : `/${entry}`;
      pageRoutes(full, prefix + segment, acc);
    } else if (entry === "page.tsx") {
      acc.push(prefix === "" ? "/" : prefix);
    }
  }
  return acc;
}

const ROUTES = pageRoutes(APP_DIR).sort();

const sourceFor = (route: string) =>
  readFileSync(join(APP_DIR, route === "/" ? "" : route.slice(1), "page.tsx"), "utf8");

/**
 * Guarded, but not reachable by a static href, so ROUTE_CAPABILITY —
 * which exists to filter the nav — would be the wrong home: a key with
 * `[id]` in it can never match a real URL, and putting one there would
 * quietly teach `canReach` to answer "open" for a guarded page. These are
 * enforced by the page's own `requireCapability`, which is the boundary
 * either way, and asserted below exactly as the mapped routes are.
 */
const PAGE_ONLY_CAPABILITY: Record<string, Capability> = {
  // A pay application IS the money document — schedule of values, stored
  // materials, retainage held. permissions.ts already says billing is not
  // an estimator's business and the field tier's audit row says the same;
  // a whole page of it behind an unguarded URL said otherwise.
  "/jobs/[id]/pay-applications/[invoiceId]": "MANAGE_BILLING",
  // "certified payroll" is named in MANAGE_COMPLIANCE's own doc comment,
  // and the page prints wage rates per employee per day.
  "/jobs/[id]/certified-payroll": "MANAGE_COMPLIANCE",
};

/**
 * Open on purpose, and the reason is the entry.
 *
 * "Everyone signed in can see this" is a legitimate answer — a dashboard
 * nobody can reach is not a product. What is not legitimate is arriving
 * at that answer by omission, which is what the whole file above is
 * about. A reason string is cheap; an unlisted door cost us this pass.
 */
const OPEN_ROUTES: Record<string, string> = {
  "/dashboard":
    "Where everyone lands, and where NoAccess sends people back to. Its money — margin, receivables — is withheld section by section inside the page and pinned by lib/page-money-guards.test.ts.",
  "/alerts":
    "The alert rows are filtered per principal in lib/alerts-query.ts (visibleToPrincipal), so the page is open and its CONTENT is not. Gating the page instead would hide a foreman's own overdue punch items.",
  "/schedule": "Job start dates and who is assigned. No money on it, and everyone needs to know where they are working.",
  "/messages": "The correspondence delivery log. Sending is what matters and that is the action's problem, not the page's.",
  "/contacts": "The address book — GCs, developers, vendors. Names and phone numbers are not a tier.",
  "/contacts/[id]":
    "Same, and its billing/job-cost/estimating sections are already withheld in-page via can() — pinned by lib/page-money-guards.test.ts.",
  "/team": "The roster. Everyone should be able to see who they work with; changing it is owner-only in the actions.",
  "/vendors":
    "The supplier directory. What each vendor has QUOTED is the sensitive half and it lives on /vendors/pricing, which is guarded.",
  "/jobs/[id]":
    "The job record is the spine every function works from, so it must not sit behind MANAGE_JOBS: ACCOUNTING holds no MANAGE_JOBS and has to reach pay apps and retainage, and PAYROLL_COMPLIANCE holds none either. Its money sections are withheld in-page and pinned by lib/page-money-guards.test.ts.",
  "/jobs/new": "Same reason as /jobs/[id]. createJob is where a real restriction on making one would belong.",
  "/jobs": "A bare redirect to /dashboard. Guarding a redirect claims a protection it redirects straight past.",
  "/estimating": "A bare redirect to /dashboard?status=ESTIMATE. Same reason as /jobs.",
  "/settings/export":
    "Guarded HARDER than any capability: the page itself refuses anyone whose role is not OWNER, because it hands over the whole company's data. A capability would loosen it.",
};

describe("every route the app serves has an access decision", () => {
  it("finds the routes at all", () => {
    // Guards the guard. If the walk or the filename ever stops matching,
    // this whole block would pass by finding nothing — the most dangerous
    // way for a check like this to fail, and the exact failure mode of
    // the version it replaces.
    expect(ROUTES.length).toBeGreaterThan(30);
    expect(ROUTES).toContain("/dashboard");
    expect(ROUTES).toContain("/safety");
    expect(ROUTES).toContain("/jobs/[id]");
  });

  it("has a decision recorded for every single one", () => {
    const undecided = ROUTES.filter(
      (route) =>
        !(route in ROUTE_CAPABILITY) &&
        !(route in PAGE_ONLY_CAPABILITY) &&
        !(route in OPEN_ROUTES),
    );

    expect(
      undecided,
      `These routes are served by the app and nobody has decided who may reach them:\n` +
        undecided.map((r) => `  ${r}`).join("\n") +
        `\n\nEvery route is a door. Put each one in ROUTE_CAPABILITY (guarded, in the nav), ` +
        `in PAGE_ONLY_CAPABILITY (guarded, dynamic route), or in OPEN_ROUTES with the reason ` +
        `it is open. Absence is not a decision — it is how MANAGE_FIELD and MANAGE_JOBS came ` +
        `to gate nothing at all while every test in this file passed.`,
    ).toEqual([]);
  });

  it("guards each mapped route at the page, not only in the nav", () => {
    // A filtered nav hides a link. The URL still works, and the data
    // behind it still renders. This is the half that is actually
    // enforcement, so it is checked against the page's own source.
    const guarded = { ...ROUTE_CAPABILITY, ...PAGE_ONLY_CAPABILITY };
    const ungated: string[] = [];

    for (const [route, capability] of Object.entries(guarded)) {
      const source = sourceFor(route);
      if (!source.includes(`requireCapability("${capability}")`) || !source.includes("NoAccess")) {
        ungated.push(`${route} (needs ${capability})`);
      }
    }

    expect(
      ungated,
      `These routes are listed as guarded and their page does not enforce it:\n` +
        ungated.map((r) => `  ${r}`).join("\n") +
        `\n\nThe page must call requireCapability("<the mapped capability>") and render ` +
        `<NoAccess /> when it comes back false — see app/(app)/backcharges/page.tsx. ` +
        `A nav filter is not access control.`,
    ).toEqual([]);
  });

  it("keeps the three lists free of routes that no longer exist", () => {
    // Stops the decision table rotting into fiction once a page is
    // renamed or deleted. A stale key is a decision about nothing, and it
    // makes the list look more complete than it is.
    const declared = [
      ...Object.keys(ROUTE_CAPABILITY),
      ...Object.keys(PAGE_ONLY_CAPABILITY),
      ...Object.keys(OPEN_ROUTES),
    ];
    const orphans = declared.filter((route) => !ROUTES.includes(route));
    expect(orphans, `Declared but no longer served: ${orphans.join(", ")}`).toEqual([]);
  });

  it("never lists a route as both guarded and open", () => {
    const contradictory = Object.keys(OPEN_ROUTES).filter(
      (route) => route in ROUTE_CAPABILITY || route in PAGE_ONLY_CAPABILITY,
    );
    expect(
      contradictory,
      `Listed as open AND as guarded: ${contradictory.join(", ")}. The open list wins nothing — ` +
        `the page guard does — so this is a comment that disagrees with the code.`,
    ).toEqual([]);
  });

  it("uses every capability that is supposed to gate a whole route", () => {
    // MANAGE_FIELD and MANAGE_JOBS were defined, documented BY ROUTE NAME
    // ("safety, punch lists, equipment", "RFIs, submittals, drawings,
    // closeout"), and mapped to zero routes. A capability that gates
    // nothing is worse than one that does not exist: the Team page counts
    // capabilities, so it told an owner they had withheld something they
    // had not.
    //
    // VIEW_JOB_COSTS is the one deliberate exception and is listed here
    // rather than skipped silently: it gates SECTIONS — margin on the job
    // page, cost on the dashboard and the contact page — and no page is
    // only job cost. Its enforcement is lib/page-money-guards.test.ts.
    const SECTION_ONLY: Capability[] = ["VIEW_JOB_COSTS"];
    const used = new Set<Capability>([
      ...Object.values(ROUTE_CAPABILITY),
      ...Object.values(PAGE_ONLY_CAPABILITY),
    ]);
    for (const capability of CAPABILITIES) {
      if (SECTION_ONLY.includes(capability)) continue;
      expect(used.has(capability), `${capability} gates no route at all`).toBe(true);
    }
  });
});
