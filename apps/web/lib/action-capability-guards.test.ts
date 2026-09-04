import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CAPABILITIES, JOB_FUNCTIONS, can, type Capability } from "./permissions";

/**
 * The half of the job-function feature that one person cannot click.
 *
 * lib/permissions.test.ts proves the map and the PAGE guards. Neither says
 * anything about the Server Actions behind those pages, and that is the
 * half where being wrong is a security hole rather than an annoyance:
 *
 *   A page guard stops a page RENDERING. A Server Action is a separate
 *   HTTP endpoint with a stable id, and it answers whoever posts to it. A
 *   guarded page in front of an open action is not a guard — and it is
 *   worse than an open page, because a page reads and an action writes.
 *
 * Verifying that needs a second team member with a different job function,
 * which the company building this does not have. So it is verified here
 * instead, and this file is deliberately built to the same rule the route
 * enumeration in lib/permissions.test.ts is built to:
 *
 *   IT MUST FAIL WHEN SOMETHING IS MISSING, NOT ONLY WHEN SOMETHING
 *   PRESENT IS WRONG.
 *
 * That rule is not decoration. The test that was supposed to catch
 * MANAGE_FIELD and MANAGE_JOBS gating nothing iterated
 * `Object.entries(ROUTE_CAPABILITY)`, so a route ABSENT from the map
 * contributed no iteration and was structurally invisible to it. A test
 * that enumerates a hand-written list cannot catch an omission from that
 * list. So nothing here starts from a hand-written list of actions:
 *
 *   1. Walk the filesystem for every page the app serves.
 *   2. Walk each page's own import graph for every Server Action it can
 *      reach, through however many components.
 *   3. Resolve each action to the module that defines it.
 *   4. Require every action reachable ONLY from pages guarded by one
 *      capability to assert that capability — and then EXECUTE it as a
 *      principal who lacks it and watch it refuse.
 *
 * Add a page, add a component, add an action, wire an existing action to a
 * guarded page: the walk finds it and this suite fails until somebody
 * decides. The only way to be absent from the check is to be absent from
 * the app.
 */

/* ------------------------------------------------------------------ *
 * 1. The database tripwire
 * ------------------------------------------------------------------ */

/**
 * `prisma`, replaced by something that screams instead of answering.
 *
 * The negative path is not "the action returned a failure" — an action can
 * return a failure for a dozen reasons that have nothing to do with access.
 * The claim worth proving is that a person without the capability is
 * turned away BEFORE the action touches any data at all. So the database
 * is not mocked with plausible answers; it is replaced with a wire that
 * records and throws on the very first property read.
 *
 * A test needing no Postgres is the point rather than a compromise: it
 * runs in the fast unit suite on every push — the one CI job that gates
 * every PR — and "no query was issued" is a stronger statement than any
 * assertion about rows could be.
 *
 * Built through `vi.hoisted` because `vi.mock` is lifted above the
 * imports, so a factory closing over an ordinary top-level `const` reads
 * it before that line has run. That failure would look like a passing
 * test, which is the one outcome this file cannot afford.
 */
const { dbTouches, tripwire, prismaNamespace, principal } = vi.hoisted(() => {
  const touches: string[] = [];

  const wire = new Proxy(
    {},
    {
      get(_target, property) {
        // Symbols and `then` are how a runtime pokes at a value it is
        // about to await or print. Answering those is not a query.
        if (typeof property === "symbol" || property === "then") return undefined;
        touches.push(String(property));
        throw new Error(
          `An action reached prisma.${String(property)} for a principal who should have ` +
            `been refused. The capability guard is missing, or it runs after the first query.`,
        );
      },
    },
  );

  // `Prisma` is imported by four of these modules for `Prisma.TransactionClient`,
  // which is a type and is erased. Nothing reads it at runtime today; if
  // something starts to, this says so instead of handing back undefined and
  // failing somewhere unrecognisable.
  const namespace = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol" || property === "then") return undefined;
        throw new Error(
          `Prisma.${String(property)} was read at runtime. This suite stubs the Prisma ` +
            `namespace because only its types were ever used; give the stub a real value.`,
        );
      },
    },
  );

  return {
    dbTouches: touches,
    tripwire: wire,
    prismaNamespace: namespace,
    /** The signed-in person, swapped per case. Same shape
     * `requireCompanyContext` returns: the User row, Company included. */
    principal: {
      id: "user_under_test",
      role: "MEMBER" as string,
      jobFunction: null as string | null,
      company: { id: "company_under_test" },
    },
  };
});

// Only `prisma` and `Prisma` are imported from this package anywhere in the
// graph these tests execute, so the module is replaced outright rather than
// spread over the real one — which would construct a PrismaClient, and
// `@prisma/client` is a dependency of packages/db, not resolvable from here.
vi.mock("@prova/db", () => ({ prisma: tripwire, Prisma: prismaNamespace }));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => principal,
}));

/* ------------------------------------------------------------------ *
 * 2. What the app actually serves, and what it can reach
 * ------------------------------------------------------------------ */

const WEB = resolve(__dirname, "..");
const APP_DIR = join(WEB, "app/(app)");
const ACTIONS_DIR = join(WEB, "lib/actions");

/** Every route Next.js serves under `(app)`, in route-pattern form.
 *
 * Deliberately a second, independent copy of the walk in
 * lib/permissions.test.ts rather than a shared helper. These two files
 * make different claims and a bug in one walk should not be able to
 * silence both — and each one guards its own walk below, because a walk
 * that quietly finds nothing is the most dangerous way for a check like
 * this to fail. */
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
const pageFile = (route: string) =>
  join(APP_DIR, route === "/" ? "" : route.slice(1), "page.tsx");

/** Which module defines each exported Server Action, read from the source
 * of every action module — so an action that MOVES between modules is
 * followed automatically rather than going missing. */
const ACTION_MODULES = readdirSync(ACTIONS_DIR)
  .filter((f) => f.endsWith(".ts") && !f.includes(".test.") && !f.includes(".dbtest."))
  .map((f) => f.replace(/\.ts$/, ""));

const moduleSource = new Map<string, string>();
const sourceOfModule = (name: string) => {
  const cached = moduleSource.get(name);
  if (cached !== undefined) return cached;
  const src = readFileSync(join(ACTIONS_DIR, `${name}.ts`), "utf8");
  moduleSource.set(name, src);
  return src;
};

const definingModule = new Map<string, string>();
for (const name of ACTION_MODULES) {
  for (const match of sourceOfModule(name).matchAll(/^export async function (\w+)/gm)) {
    definingModule.set(match[1], name);
  }
}

/** Resolve an import specifier to a file inside this app, or null for a
 * package. Only local files are followed — the walk is about our own
 * component tree, not node_modules. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(WEB, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return null;

  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;

/** Every Server Action reachable from one page, following local imports as
 * far as they go. Components import actions BY NAME from the `@/lib/actions`
 * barrel, so the name is what the graph yields and `definingModule` turns
 * it back into a module. */
function actionsReachableFrom(entry: string): Set<string> {
  const visited = new Set<string>();
  const found = new Set<string>();
  const stack = [entry];

  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (visited.has(file)) continue;
    visited.add(file);

    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const clause = match[1];
      const specifier = match[2];
      // `import type { … }` is erased at build time and reaches no code.
      if (clause.trimStart().startsWith("type ")) continue;

      if (specifier === "@/lib/actions" || specifier.startsWith("@/lib/actions/")) {
        const named = clause.match(/\{([\s\S]*)\}/);
        if (!named) continue;
        for (const part of named[1].split(",")) {
          const name = part.trim().split(/\s+as\s+/)[0].trim();
          if (name && !name.startsWith("type ") && definingModule.has(name)) found.add(name);
        }
        continue;
      }

      const resolved = resolveLocal(specifier, file);
      if (resolved) stack.push(resolved);
    }
  }
  return found;
}

/** The capability each page demands, read from the PAGE'S OWN SOURCE
 * rather than from ROUTE_CAPABILITY.
 *
 * This is the boundary that actually runs, and reading it here means a
 * dynamic route guarded only at the page — `/jobs/[id]/certified-payroll`,
 * which can never appear in a map keyed by static href — is covered by the
 * same sweep as everything else, with nothing to keep in step by hand. */
function capabilityDemandedByPage(route: string): Capability | null {
  const source = readFileSync(pageFile(route), "utf8");
  const demanded = new Set(
    [...source.matchAll(/requireCapability\("([A-Z_]+)"\)/g)].map((m) => m[1]),
  );
  // No page needs two today. If one ever does, "which capability do the
  // actions behind it answer to" stops having a single answer, and
  // silently taking the first match would pick one at random — so it says
  // so instead.
  if (demanded.size > 1) {
    throw new Error(
      `${route} guards itself with more than one capability (${[...demanded].join(", ")}). ` +
        `Decide which one the Server Actions behind it must assert, then teach this walk.`,
    );
  }
  const [first] = demanded;
  if (!first) return null;
  const capability = first as Capability;
  return CAPABILITIES.includes(capability) ? capability : null;
}

/** action name -> the capabilities of every page that can reach it.
 * `null` in the set means "a page that demands no capability". */
const reachedBy = new Map<string, Map<string, Capability | null>>();
for (const route of ROUTES) {
  const capability = capabilityDemandedByPage(route);
  for (const action of actionsReachableFrom(pageFile(route))) {
    if (!reachedBy.has(action)) reachedBy.set(action, new Map());
    (reachedBy.get(action) as Map<string, Capability | null>).set(route, capability);
  }
}

/** An action every one of whose doors demands the SAME capability. Anything
 * else — reachable from an open page too, or from pages demanding different
 * capabilities — is a genuine design question rather than an omission, and
 * is settled explicitly further down. */
function soleCapabilityGating(action: string): Capability | null {
  const doors = reachedBy.get(action);
  if (!doors || doors.size === 0) return null;
  const capabilities = new Set(doors.values());
  if (capabilities.size !== 1) return null;
  const only = [...capabilities][0];
  return only ?? null;
}

/** Does this action's body assert `capability`?
 *
 * Both shapes count, because both are real and the choice between them is
 * about error delivery, not about strength: `requireCapabilityForAction`
 * THROWS (matching the modules whose other guards throw), and
 * `can(context, …)` + a returned failure is what a module returning
 * `ActionResult` must use, since production redacts a thrown Server Action
 * message.
 *
 * A source check is shape, not behaviour, and this repo has been bitten by
 * shape checks that passed over real defects. It is here only to name the
 * offender precisely; the claim is proved by execution below. */
function bodyOfAction(action: string): string {
  const owningModule = definingModule.get(action);
  if (!owningModule) return "";
  const source = sourceOfModule(owningModule);
  const start = source.indexOf(`export async function ${action}`);
  if (start < 0) return "";

  let depth = 0;
  let index = source.indexOf("{", start);
  for (; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(start, index + 1);
}

function assertsCapability(action: string, capability: Capability): boolean {
  const body = bodyOfAction(action);
  return (
    body.includes(`requireCapabilityForAction("${capability}"`) ||
    body.includes(`can(context, "${capability}")`)
  );
}

/* ------------------------------------------------------------------ *
 * 3. The decisions
 * ------------------------------------------------------------------ */

/**
 * Actions reachable only from pages guarded by one capability, which do NOT
 * assert it. Every entry is a live hole: the page is closed and the
 * endpoint behind it is open.
 *
 * THIS LIST MAY ONLY EVER SHRINK. It is not permission to leave an action
 * open — it is the debt, counted, so that it cannot quietly grow. A new
 * action lands here only by someone adding a line and explaining
 * themselves, and the check below fails just as loudly on a line that is no
 * longer true as on a missing one.
 *
 * Split by provenance because the two halves want different owners, not
 * because one is more acceptable than the other.
 */

/** Behind routes that this pass newly closed: `/closeout` (MANAGE_JOBS) and
 * `/settings/integrations` (MANAGE_COMPLIANCE). These are the gap this pass
 * OPENED — before it, the page was open too, so page and action agreed;
 * now the page refuses and the endpoint behind it does not, which is the
 * exact shape every comment in this feature calls the worse one.
 *
 * Not fixed in the same pass, and the reason is the working agreement
 * rather than the code: `closeoutSubmissions.ts` and `integrations.ts`
 * belong to other lanes (WORK-SPLIT.md — closeout submissions to the third
 * lane, integrations to Diego's), and touching another lane's file is
 * NINE of these were paid off — every non-delete write to a closeout
 * package now asserts MANAGE_JOBS. What remains below is the four DELETES,
 * and they are a different axis rather than an unpaid debt: each already
 * calls `assertOwner`, and an OWNER holds every capability by construction,
 * so no principal exists who is refused by the page and admitted by them.
 * They stay listed because this file records what the code ASSERTS, and an
 * owner check stops covering for them the moment the role model gains a
 * third value.
 *
 * supposed to be announced first. `closeout.ts` is in this lane and could
 * have been done here; gating nine of the thirteen actions on one page and
 * leaving four would make `/closeout` half-enforced, which is harder to
 * reason about than a whole page consistently listed as debt. They go
 * together, in one pass, with the ping that the agreement asks for. */
const OPEN_BEHIND_A_NEWLY_CLOSED_PAGE: Record<string, Capability> = {
  "closeout.deleteCloseoutItem": "MANAGE_JOBS",
  "closeout.deleteWarrantyPeriod": "MANAGE_JOBS",
  "closeout.deleteServiceRequest": "MANAGE_JOBS",
  "closeoutSubmissions.deleteCloseoutSubmission": "MANAGE_JOBS",
  "integrations.connectSandboxIntegration": "MANAGE_COMPLIANCE",
  "integrations.disconnectSandboxIntegration": "MANAGE_COMPLIANCE",
};

/** Behind routes that were already guarded before any of this — `/settings`,
 * `/compliance`, `/union-compliance`, `/prevailing-wage`, `/catalog`,
 * `/vendors/pricing`, `/backcharges`. The nav-level gate on these has been
 * claiming more than it delivers since it was written, and nobody knew
 * because nothing counted.
 *
 * Listed rather than fixed because every one of them is somebody else's
 * lane and the fix is per-module judgement about throw-versus-return, not a
 * sweep. The value of writing them down is that the number is now known
 * and can only go down. */
const OPEN_BEHIND_AN_ALREADY_GUARDED_PAGE: Record<string, Capability> = {
  "backcharges.createBackcharge": "MANAGE_BILLING",
  "backcharges.updateBackcharge": "MANAGE_BILLING",
  "backcharges.disputeBackcharge": "MANAGE_BILLING",
  "backcharges.resolveBackcharge": "MANAGE_BILLING",
  "backcharges.reopenBackcharge": "MANAGE_BILLING",
  "backcharges.deleteBackcharge": "MANAGE_BILLING",
  "billing.disconnectQuickBooks": "MANAGE_COMPLIANCE",
  "billing.testQuickBooksConnection": "MANAGE_COMPLIANCE",
  "quickbooks.loadQuickBooksAccounts": "MANAGE_COMPLIANCE",
  "quickbooks.saveQuickBooksAccountMapping": "MANAGE_COMPLIANCE",
  "quickbooks.clearQuickBooksAccountMapping": "MANAGE_COMPLIANCE",
  "quickbooks.reconcileQuickBooksInvoices": "MANAGE_COMPLIANCE",
  "company.createCompanyLocation": "MANAGE_COMPLIANCE",
  "company.deleteCompanyLocation": "MANAGE_COMPLIANCE",
  "compliance.createCompanyLicense": "MANAGE_COMPLIANCE",
  "compliance.updateCompanyLicense": "MANAGE_COMPLIANCE",
  "compliance.deleteCompanyLicense": "MANAGE_COMPLIANCE",
  "compliance.createInsurancePolicy": "MANAGE_COMPLIANCE",
  "compliance.deleteInsurancePolicy": "MANAGE_COMPLIANCE",
  "compliance.createBond": "MANAGE_COMPLIANCE",
  "compliance.deleteBond": "MANAGE_COMPLIANCE",
  "compliance.uploadComplianceDocument": "MANAGE_COMPLIANCE",
  "compliance.updateComplianceDocument": "MANAGE_COMPLIANCE",
  "compliance.deleteComplianceDocument": "MANAGE_COMPLIANCE",
  "compliance.markComplianceDocumentReceived": "MANAGE_COMPLIANCE",
  "estimating.createLineItemCatalogEntry": "MANAGE_ESTIMATING",
  "estimating.deleteLineItemCatalogEntry": "MANAGE_ESTIMATING",
  "estimating.importCatalogEntries": "MANAGE_ESTIMATING",
  "estimating.updateCatalogDefaultsFromActuals": "MANAGE_ESTIMATING",
  "vendorPricing.createVendorPriceQuote": "MANAGE_ESTIMATING",
  "vendorPricing.updateVendorPriceQuote": "MANAGE_ESTIMATING",
  "vendorPricing.deleteVendorPriceQuote": "MANAGE_ESTIMATING",
  "prevailingWage.createPrevailingWageRuleSet": "MANAGE_COMPLIANCE",
  "prevailingWage.updatePrevailingWageRuleSet": "MANAGE_COMPLIANCE",
  "prevailingWage.deletePrevailingWageRuleSet": "MANAGE_COMPLIANCE",
  "prevailingWage.setDeterminationRuleSet": "MANAGE_COMPLIANCE",
  "unionCompliance.createUnionLocalAndAgreement": "MANAGE_COMPLIANCE",
  "unionCompliance.endUnionAgreement": "MANAGE_COMPLIANCE",
  "unionCompliance.createCraftClassification": "MANAGE_COMPLIANCE",
  "unionCompliance.deleteCraftClassification": "MANAGE_COMPLIANCE",
  "unionCompliance.setCraftTier": "MANAGE_COMPLIANCE",
  "unionCompliance.createFringeRateSchedule": "MANAGE_COMPLIANCE",
  "unionCompliance.endFringeRateSchedule": "MANAGE_COMPLIANCE",
  "unionCompliance.deleteFringeRateSchedule": "MANAGE_COMPLIANCE",
  "unionCompliance.setApprenticeRatioRule": "MANAGE_COMPLIANCE",
  "apprenticeship.createApprenticeshipEnrollment": "MANAGE_COMPLIANCE",
  // Arrived on `main` in #117/#127 while this branch was open, ungated like
  // its five siblings. Listed here on the merge rather than fixed, for the
  // same reason as the rest of the module: gating one of six would leave
  // /union-compliance half-enforced, and the module is not this lane's.
  "apprenticeship.updateApprenticeshipEnrollment": "MANAGE_COMPLIANCE",
  "apprenticeship.deleteApprenticeshipEnrollment": "MANAGE_COMPLIANCE",
  "apprenticeship.recordApprenticeshipPeriod": "MANAGE_COMPLIANCE",
  "apprenticeship.updateApprenticeshipPeriod": "MANAGE_COMPLIANCE",
  "apprenticeship.deleteApprenticeshipPeriod": "MANAGE_COMPLIANCE",
};

const KNOWN_OPEN: Record<string, Capability> = {
  ...OPEN_BEHIND_A_NEWLY_CLOSED_PAGE,
  ...OPEN_BEHIND_AN_ALREADY_GUARDED_PAGE,
};

/**
 * Actions whose doors DISAGREE — reachable from a guarded page and from an
 * open one, or from pages wanting different capabilities. The rule above
 * cannot decide these, so each is decided here by hand and the decision is
 * the entry.
 *
 * `capability: null` means deliberately ungated, and the reason must say
 * what would break otherwise. The check below verifies the decision against
 * the code either way, so a "deliberately ungated" line that later acquires
 * a guard fails just as loudly as a guard that goes missing.
 */
const MIXED_DOORS: Record<string, { capability: Capability | null; reason: string }> = {
  "fieldReports.createDailyFieldReport": {
    capability: null,
    reason:
      "Composed on /field-reports (MANAGE_FIELD) AND on /jobs/[id], which is open on purpose — accounting and payroll/compliance both have to open a job. Gating it would leave a composer rendering on the job page for people it then refuses, which is a worse experience than the current one and a change to jobs/[id]/page.tsx, in the other lane. Hiding the section there is the prerequisite.",
  },
  "fieldReports.updateDailyFieldReport": {
    capability: null,
    reason: "Same two doors and the same prerequisite as createDailyFieldReport.",
  },
  "fieldReports.deleteDailyFieldReport": {
    capability: "MANAGE_FIELD",
    reason:
      "Gated despite also being reachable from the open job page, and deliberately the odd one out: it had NO guard of any kind, not even assertOwner, while every other delete in that folder had at least one. A daily field report is what a delay claim is argued from months later. Removing evidence is not symmetrical with composing it, so the two-door argument that leaves create and update open does not extend to this.",
  },
};

/* ------------------------------------------------------------------ *
 * 4. The checks
 * ------------------------------------------------------------------ */

describe("the walk this file's claims rest on", () => {
  it("finds the pages, the actions, and the wiring between them", () => {
    // Guards the guard. Every assertion below is of the form "nothing was
    // found to be wrong", and a walk that finds nothing satisfies all of
    // them while proving nothing. That is the exact failure mode of the
    // enumeration this whole approach replaces, so it is checked first.
    expect(ROUTES.length).toBeGreaterThan(30);
    expect(ROUTES).toContain("/safety");
    expect(definingModule.get("createSafetyIncident")).toBe("safety");
    expect(definingModule.get("deleteMaterialDelivery")).toBe("materialOrders");
    expect(definingModule.size).toBeGreaterThan(100);

    // The import graph really does cross component files: nothing on
    // /safety's page imports an action directly — SafetyIncidentForm does.
    expect(actionsReachableFrom(pageFile("/safety"))).toContain("createSafetyIncident");
    expect(capabilityDemandedByPage("/safety")).toBe("MANAGE_FIELD");
    expect(capabilityDemandedByPage("/dashboard")).toBeNull();

    // And a page guarded ONLY at the page, never in ROUTE_CAPABILITY,
    // is picked up by reading the source rather than the map.
    expect(capabilityDemandedByPage("/jobs/[id]/certified-payroll")).toBe("MANAGE_COMPLIANCE");
  });
});

/** Every action whose doors agree on one capability, and which must
 * therefore assert it. Derived, never typed out. */
const MUST_ASSERT: { action: string; moduleName: string; capability: Capability }[] = [];
for (const action of [...reachedBy.keys()].sort()) {
  const moduleName = definingModule.get(action) as string;
  const key = `${moduleName}.${action}`;
  const mixed = MIXED_DOORS[key];
  const capability = mixed ? mixed.capability : soleCapabilityGating(action);
  if (!capability) continue;
  if (!mixed && key in KNOWN_OPEN) continue;
  MUST_ASSERT.push({ action, moduleName, capability });
}

describe("every write behind a guarded page answers to the same capability", () => {
  it("leaves no action reachable only from a guarded page without a guard", () => {
    const holes: string[] = [];

    for (const action of [...reachedBy.keys()].sort()) {
      const capability = soleCapabilityGating(action);
      if (!capability) continue;
      const moduleName = definingModule.get(action) as string;
      const key = `${moduleName}.${action}`;
      if (key in KNOWN_OPEN || key in MIXED_DOORS) continue;
      if (assertsCapability(action, capability)) continue;

      const doors = [...(reachedBy.get(action) as Map<string, Capability | null>).keys()];
      holes.push(`${key} (needs ${capability}; reachable from ${doors.join(", ")})`);
    }

    expect(
      holes,
      `These Server Actions sit behind a page that refuses people, and answer them anyway:\n` +
        holes.map((h) => `  ${h}`).join("\n") +
        `\n\nA page guard stops a page rendering. The action behind it is a separate ` +
        `endpoint with a stable id and it answers whoever posts to it. Assert the same ` +
        `capability inside the action: requireCapabilityForAction("<capability>", "<message>") ` +
        `in a module whose guards throw, or can(context, "<capability>") plus a returned ` +
        `failure in a module returning ActionResult — production redacts a thrown message. ` +
        `If it must stay open, say so in MIXED_DOORS or in one of the two lists above, ` +
        `with the reason. Absence is not a decision.`,
    ).toEqual([]);
  });

  it("keeps the open lists honest — no stale entry, no entry that is now guarded", () => {
    // The companion failure, and the one that turns a debt list into
    // fiction: an entry that has been fixed, or that names an action the
    // app no longer wires to a guarded page. Either makes the list look
    // longer and more considered than it is.
    const stale: string[] = [];

    for (const [key, capability] of Object.entries(KNOWN_OPEN)) {
      const action = key.split(".")[1];
      if (definingModule.get(action) !== key.split(".")[0]) {
        stale.push(`${key} — no such action in that module any more`);
        continue;
      }
      if (assertsCapability(action, capability)) {
        stale.push(`${key} — now asserts ${capability}; delete this line, the debt is paid`);
        continue;
      }
      if (soleCapabilityGating(action) !== capability) {
        stale.push(`${key} — is no longer reachable only from ${capability} pages`);
      }
    }

    for (const [key, decision] of Object.entries(MIXED_DOORS)) {
      const action = key.split(".")[1];
      if (definingModule.get(action) !== key.split(".")[0]) {
        stale.push(`${key} — no such action in that module any more`);
        continue;
      }
      if (!reachedBy.has(action)) {
        stale.push(`${key} — no page reaches it; it is not a mixed-door case`);
        continue;
      }
      const capabilities = new Set((reachedBy.get(action) as Map<string, Capability | null>).values());
      if (capabilities.size < 2) {
        stale.push(`${key} — its doors now agree; the ordinary rule decides it, delete this entry`);
      }
      if (decision.capability === null) {
        for (const capability of CAPABILITIES) {
          if (assertsCapability(action, capability)) {
            stale.push(`${key} — recorded as deliberately ungated and now asserts ${capability}`);
          }
        }
      } else if (!assertsCapability(action, decision.capability)) {
        stale.push(`${key} — recorded as gated on ${decision.capability} and does not assert it`);
      }
      expect(decision.reason.length).toBeGreaterThan(40);
    }

    expect(stale, `The recorded decisions no longer match the code:\n${stale.join("\n")}`).toEqual([]);
  });

  it("still covers the whole surface this pass claimed to close", () => {
    // A blunt count, because every check above is a "nothing is wrong"
    // assertion and those all pass on an empty set. If a future change
    // unwires a page from its actions, the holes list stays empty and the
    // suite would go quiet about thirty-five real endpoints.
    expect(MUST_ASSERT.length).toBeGreaterThanOrEqual(35);

    const byCapability = (capability: Capability) =>
      MUST_ASSERT.filter((entry) => entry.capability === capability).map((e) => e.action);

    // The two capabilities that gated nothing at all.
    expect(byCapability("MANAGE_FIELD").length).toBeGreaterThanOrEqual(16);
    expect(byCapability("MANAGE_JOBS").length).toBeGreaterThanOrEqual(17);

    // The two deletes that had no guard of any kind — not owner, not
    // capability — named here so they can never fall out silently.
    expect(byCapability("MANAGE_FIELD")).toContain("deleteDailyFieldReport");
    expect(byCapability("MANAGE_FIELD")).toContain("deleteMaterialDelivery");
  });
});

/* ------------------------------------------------------------------ *
 * 5. Executing the refusal
 * ------------------------------------------------------------------ */

/**
 * The modules holding an action that must assert a capability.
 *
 * Static imports, because a fully dynamic specifier is not something to
 * rely on a bundler resolving — but the map is asserted COMPLETE against
 * the derived set below, so a new module still fails this suite rather
 * than slipping past it. That assertion is what keeps this list from being
 * the hand-written enumeration the whole file exists to avoid.
 */
const MODULE_IMPORTS: Record<string, () => Promise<Record<string, unknown>>> = {
  safety: () => import("./actions/safety"),
  punchLists: () => import("./actions/punchLists"),
  equipment: () => import("./actions/equipment"),
  equipmentAssignments: () => import("./actions/equipmentAssignments"),
  fieldReports: () => import("./actions/fieldReports"),
  materialOrders: () => import("./actions/materialOrders"),
  rfis: () => import("./actions/rfis"),
  submittals: () => import("./actions/submittals"),
  drawings: () => import("./actions/drawings"),
  closeout: () => import("./actions/closeout"),
  closeoutSubmissions: () => import("./actions/closeoutSubmissions"),
};

/** The sentence both guard messages share. Asserting on this rather than on
 * "it failed" is the whole point: an action given junk arguments fails for
 * a dozen reasons, and only one of them is the one being tested. */
const REFUSED = /part of your job function/;

type Attempt = { refused: boolean; message: string; touchedDb: boolean };

/** Call an action the way the network would, and report what came back.
 *
 * Three arguments, always: the real signatures are `(formData)`,
 * `(id, formData)` and `(id, boolean)`, JavaScript ignores the extras, and
 * a guard that runs before its arguments are read does not care what they
 * are. Which is itself the property under test — if the guard has moved
 * below the first use of an argument, this call reaches that use and the
 * message comes back wrong. */
async function attempt(fn: unknown): Promise<Attempt> {
  const before = dbTouches.length;
  const callable = fn as (...args: unknown[]) => Promise<unknown>;
  let message: string;

  try {
    const result = await callable(new FormData(), new FormData(), new FormData());
    const failed = result as { ok?: boolean; error?: string } | undefined;
    message = failed && failed.ok === false ? String(failed.error) : `returned ${JSON.stringify(result)}`;
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  return {
    refused: REFUSED.test(message),
    message,
    touchedDb: dbTouches.length > before,
  };
}

describe("a principal without the capability is refused by the action itself", () => {
  beforeEach(() => {
    dbTouches.length = 0;
    principal.role = "MEMBER";
    principal.jobFunction = null;
  });

  it("covers every module the derivation found, with nothing imported by hand alone", () => {
    // Keeps MODULE_IMPORTS from becoming the hand-written list this file
    // exists to avoid. A new gated module fails here by name.
    const needed = [...new Set(MUST_ASSERT.map((entry) => entry.moduleName))].sort();
    expect(
      needed,
      `MODULE_IMPORTS must name exactly the modules the walk found gated actions in. ` +
        `Add the missing import — an action in an unimported module is never executed ` +
        `by the cases below, and would pass this suite without ever running.`,
    ).toEqual(Object.keys(MODULE_IMPORTS).sort());
  });

  for (const { action, moduleName, capability } of MUST_ASSERT) {
    const withoutIt = JOB_FUNCTIONS.filter(
      (jobFunction) => !can({ role: "MEMBER", jobFunction }, capability),
    );
    const withIt = JOB_FUNCTIONS.filter((jobFunction) =>
      can({ role: "MEMBER", jobFunction }, capability),
    );

    it(`${moduleName}.${action} refuses everyone without ${capability}`, async () => {
      const loaded = await (MODULE_IMPORTS[moduleName] as () => Promise<Record<string, unknown>>)();
      const fn = loaded[action];
      expect(fn, `${moduleName}.${action} is not exported any more`).toBeTypeOf("function");

      // There has to BE somebody it withholds this from, or the assertion
      // below is vacuously true for a capability everybody holds.
      expect(withoutIt.length).toBeGreaterThan(0);

      for (const jobFunction of withoutIt) {
        principal.role = "MEMBER";
        principal.jobFunction = jobFunction;

        const outcome = await attempt(fn);
        expect(
          outcome.refused,
          `${moduleName}.${action} did not refuse a MEMBER whose job function is ${jobFunction}, ` +
            `who holds no ${capability}. It answered: ${outcome.message}`,
        ).toBe(true);

        // The stronger half. Refusing is not enough if the refusal
        // arrives after a read or, worse, a write.
        expect(
          outcome.touchedDb,
          `${moduleName}.${action} queried the database before refusing ${jobFunction} ` +
            `(first touch: prisma.${dbTouches[0]}). The guard must come first.`,
        ).toBe(false);
      }
    });

    it(`${moduleName}.${action} lets ${capability} through to fail for other reasons`, async () => {
      // The control, and without it the test above proves nothing: an
      // action that refused EVERYONE would satisfy it perfectly. So the
      // people who hold the capability must get some OTHER failure from
      // these junk arguments — a missing field, or the database tripwire —
      // and never the access message.
      const loaded = await (MODULE_IMPORTS[moduleName] as () => Promise<Record<string, unknown>>)();
      const fn = loaded[action];

      for (const jobFunction of [null, ...withIt]) {
        principal.role = "MEMBER";
        principal.jobFunction = jobFunction;

        const outcome = await attempt(fn);
        expect(
          outcome.refused,
          `${moduleName}.${action} refused a MEMBER whose job function is ${jobFunction ?? "unset"}, ` +
            `who DOES hold ${capability}. This locks a real person out of their own work.`,
        ).toBe(false);
      }

      // And an owner, always — the rule that stops this feature being able
      // to lock somebody out of their own company.
      principal.role = "OWNER";
      principal.jobFunction = "FIELD";
      expect((await attempt(fn)).refused).toBe(false);
    });
  }
});
