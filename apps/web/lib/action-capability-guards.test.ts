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

  /**
   * `Prisma.Decimal`, and nothing else that can be used without noticing.
   *
   * Most modules import `Prisma` only for `Prisma.TransactionClient`,
   * which is a type and is erased. `lib/change-order.ts` is the exception:
   * it builds `new Prisma.Decimal(0)` at MODULE LOAD, so importing
   * `lib/actions/changeOrders.ts` at all needs a constructible Decimal,
   * and `@prisma/client` is a dependency of packages/db and not resolvable
   * from here.
   *
   * So the stub constructs and refuses to compute. That split is
   * deliberate: these cases prove a principal is turned away BEFORE any
   * work happens, so no correct run ever reaches Decimal arithmetic — and
   * a stub that quietly returned plausible numbers could let a guard that
   * runs too late look like one that runs early enough. If a case ever
   * does reach the maths, it says so by name instead.
   */
  class DecimalStub {
    value: unknown;
    constructor(value: unknown) {
      this.value = value;
    }
    private refuse(): never {
      throw new Error(
        `Prisma.Decimal arithmetic ran in this suite. Every case here should be refused ` +
          `before any figure is computed — if this is reached, the guard runs too late.`,
      );
    }
    plus() { return this.refuse(); }
    minus() { return this.refuse(); }
    times() { return this.refuse(); }
    dividedBy() { return this.refuse(); }
    equals() { return this.refuse(); }
    toString() { return this.refuse(); }
  }

  const namespace = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol" || property === "then") return undefined;
        if (property === "Decimal") return DecimalStub;
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

/** Every route Next.js serves under `(app)`, in route-pattern form, and
 * the real file each one is served from.
 *
 * Deliberately a second, independent copy of the walk in
 * lib/permissions.test.ts rather than a shared helper. These two files
 * make different claims and a bug in one walk should not be able to
 * silence both — and each one guards its own walk below, because a walk
 * that quietly finds nothing is the most dangerous way for a check like
 * this to fail.
 *
 * The file is recorded AS FOUND rather than reconstructed from the route
 * string afterward: a `(group)` folder vanishes from the route but not
 * from the real path, so a route living inside one — `/jobs/[id]/estimate`
 * is the first, under `(tabs)` — would resolve to a file that does not
 * exist if the path were rebuilt from the route alone. */
const routeFile = new Map<string, string>();
function pageRoutes(dir: string, prefix = "", acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const segment = /^\(.*\)$/.test(entry) ? "" : `/${entry}`;
      pageRoutes(full, prefix + segment, acc);
    } else if (entry === "page.tsx") {
      const route = prefix === "" ? "/" : prefix;
      acc.push(route);
      routeFile.set(route, full);
    }
  }
  return acc;
}

const ROUTES = pageRoutes(APP_DIR).sort();
const pageFile = (route: string) => {
  const file = routeFile.get(route);
  if (!file) throw new Error(`no page.tsx found for route ${route}`);
  return file;
};

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

/* ---------------------------------------------------------------- *
 * 2b. The half this file could not see, and reported green over
 * ---------------------------------------------------------------- */

/**
 * A page can refuse in TWO ways, and until now this walk only knew one.
 *
 *   HARD: `requireCapability("X")` + `<NoAccess>`. The route itself is
 *         withheld. `capabilityDemandedByPage` above reads it.
 *   SOFT: the route renders, and the page withholds its CONTENT behind
 *         `can(principal, "X")` — either directly or through
 *         `jobCapabilities()`'s four named flags. `/jobs/[id]/billing`
 *         returns "This tab isn't part of your access" and nothing else.
 *
 * A soft gate is a real boundary for the READER and no boundary at all for
 * the WRITER, which is the worse half of the shape every comment in this
 * file warns about — and this walk was structurally unable to say so.
 * `soleCapabilityGating` folded "every door demands nothing" into the same
 * `null` as "the doors disagree", so an action whose only door was a
 * soft-gated page contributed NO iteration and could never appear in
 * `MUST_ASSERT`. The suite then passed, loudly, over every write behind
 * `/jobs/[id]/estimate`, `/billing` and `/retainage`.
 *
 * That is this repo's recurring shape (CLAUDE.md, "a check that cannot
 * distinguish refuted from never ran"): the check was not lying, it was
 * answering about a set it had already excluded. So the fix is not a
 * bigger allowlist — it is teaching the walk that a withheld page is a
 * guarded page, and then proving the walk still sees everything.
 */
const FLAG_CAPABILITY: Record<string, Capability> = {
  showsJobMoney: "VIEW_JOB_COSTS",
  showsBilling: "MANAGE_BILLING",
  showsField: "MANAGE_FIELD",
  showsJobManagement: "MANAGE_JOBS",
};

/** Every capability a page's own source withholds content behind. */
function capabilitiesWithheldByPage(route: string): Set<Capability> {
  const source = readFileSync(pageFile(route), "utf8");
  const found = new Set<Capability>();
  for (const [flag, capability] of Object.entries(FLAG_CAPABILITY)) {
    if (new RegExp(`\\b${flag}\\b`).test(source)) found.add(capability);
  }
  for (const match of source.matchAll(/\bcan\(principal,\s*"([A-Z_]+)"/g)) {
    const capability = match[1] as Capability;
    if (CAPABILITIES.includes(capability)) found.add(capability);
  }
  return found;
}

/** Counted from a literal that CANNOT drift with the extraction above.
 *
 * The lesson `lib/scratch-cleanup-order.test.ts` paid for: a check that
 * derives its own input has two failure modes and only one of them looks
 * like a failure. If `capabilitiesWithheldByPage`'s patterns stop matching
 * — a flag renamed, `jobCapabilities` restructured, a stray space — the
 * derived sets below quietly shrink to nothing, every "no holes found"
 * assertion passes, and this whole section goes silent again. So the
 * pages that withhold ANYTHING are counted by a separate literal, and the
 * classification is required to account for exactly that many. */
const PAGES_THAT_WITHHOLD = ROUTES.filter((route) =>
  /jobCapabilities\(|can\(principal, "/.test(readFileSync(pageFile(route), "utf8")),
);

/** A page withholding behind exactly ONE capability: that capability is
 * what its actions must answer to, the same way a hard gate's is. */
const SOFT_GATED: Map<string, Capability> = new Map();
/** A page withholding behind SEVERAL, section by section. Which section a
 * given action belongs to is a per-section judgement this walk cannot make
 * — so these pages contribute no capability and their actions stay
 * undecidable by the ordinary rule, exactly as before. Listed, with the
 * capabilities involved, so the count above balances and so the set is
 * visible rather than merely absent. */
const SOFT_GATED_AMBIGUOUS: Map<string, Capability[]> = new Map();

for (const route of PAGES_THAT_WITHHOLD) {
  const withheld = [...capabilitiesWithheldByPage(route)].sort();
  if (withheld.length === 1) SOFT_GATED.set(route, withheld[0]);
  else SOFT_GATED_AMBIGUOUS.set(route, withheld);
}

/** What a page refuses people for, hard or soft. */
function effectiveCapability(route: string): Capability | null {
  return capabilityDemandedByPage(route) ?? SOFT_GATED.get(route) ?? null;
}

/** action name -> the capabilities of every page that can reach it.
 * `null` in the set means "a page that refuses nobody". */
const reachedBy = new Map<string, Map<string, Capability | null>>();
for (const route of ROUTES) {
  const capability = effectiveCapability(route);
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
  // The six backcharge actions were here until this pass. Paid off whole
  // rather than in part — a GC's deduction against what it owes is the
  // highest-risk thing left on the already-guarded pages, and gating some
  // of six would leave /backcharges half-enforced, which this file's own
  // /closeout note argues is harder to reason about than a consistent
  // state. They are in MUST_ASSERT now and executed like everything else.
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
  // MOVED HERE at the #249 merge, from OPEN_BEHIND_AN_ALREADY_GUARDED_PAGE,
  // and the journey is the point: this entry has now been correct in three
  // different lists in two days, because the thing it describes is the SET OF
  // PAGES that reach one action, and every branch that adds a HANDOFF form
  // changes that set without touching the action.
  //
  //   - two doors, /punch-lists (MANAGE_FIELD) + /rfis (MANAGE_JOBS): mixed;
  //   - punch items became a DIRECT command, PunchListForm stopped calling
  //     it, one door left: open-behind-a-guarded-page;
  //   - #249 gave the composer an email hand-off, so /messages calls it too,
  //     and /messages is in no ROUTE_CAPABILITY entry and asserts nothing on
  //     the page. Two doors again, and this time they disagree about whether
  //     there is a capability at all.
  //
  // Recorded as deliberately ungated rather than gated on MANAGE_JOBS, which
  // is what the one-door version of this entry said. Gating it on MANAGE_JOBS
  // now would refuse the email hand-off to everyone who can reach /messages
  // and cannot manage jobs — i.e. break #249's own feature — and gating it on
  // whatever /messages wants would refuse the RFI one.
  //
  // What actually guards it is not a capability: it settles the asking
  // person's OWN card and nothing else (`createdByUserId` and `companyId`
  // both in its `updateMany` where-clause, mode HANDOFF, unclaimed,
  // unsettled), and the only thing it writes is that card's outcome. So the
  // capability-shaped answer is the wrong shape: what it should ask is
  // whether the card's own command is one this person could run
  // (`canRunCommand`), which follows the card rather than the page it was
  // opened on and is right for the next HANDOFF command too. That is
  // lib/actions/ask.ts, Diego's lane (WORK-SPLIT.md), so it is recorded
  // rather than guessed at from a merge.
  "ask.settleAskDraft": {
    capability: null,
    reason:
      "Reached from /rfis (MANAGE_JOBS) and from /messages (ungated), so no one capability can be asserted without breaking one of the two hand-offs. It is self-scoped instead: updateMany where-clause pins companyId AND createdByUserId, mode HANDOFF, unclaimed and unsettled, and the only column it writes is that card's own outcome. The right guard is canRunCommand on the card's command, in the ask lane.",
  },
  // Two doors that disagree only because one of them is the Ask
  // settings page: `/jobs/[id]/billing` withholds on MANAGE_BILLING, and
  // `/settings/assistant` demands MANAGE_COMPLIANCE because it lists every
  // person's Ask proposals and amounts — it reaches this action only by
  // importing the command registry, never by rendering a payment form.
  // Gated on MANAGE_BILLING regardless, which is not a new judgement: the
  // `log_payment` Ask command declares MANAGE_BILLING already
  // (lib/ask/commands/billing.ts), so the two surfaces now agree instead
  // of one of them being open.
  "billing.logPayment": {
    capability: "MANAGE_BILLING",
    reason:
      "Reached from /jobs/[id]/billing, which withholds the whole tab on MANAGE_BILLING, and from /settings/assistant, which demands MANAGE_COMPLIANCE only because it imports the Ask command registry to list proposals — there is no payment form on it. MANAGE_BILLING is the capability the matching Ask command (log_payment) already declares, so gating it here makes the action agree with its own command rather than adding a new rule.",
  },
  "fieldReports.deleteDailyFieldReport": {
    capability: "MANAGE_FIELD",
    reason:
      "Gated despite also being reachable from the open job page, and deliberately the odd one out: it had NO guard of any kind, not even assertOwner, while every other delete in that folder had at least one. A daily field report is what a delay claim is argued from months later. Removing evidence is not symmetrical with composing it, so the two-door argument that leaves create and update open does not extend to this.",
  },
  // Surfaced by the ambiguous-page enumeration added below, and it already
  // asserts what its strictest door demands, so this records rather than
  // changes anything. Three doors: /intake (MANAGE_JOBS), /dashboard and
  // /ask (neither of which refuses the route), so the ordinary rule cannot
  // settle it. MANAGE_JOBS is right for the same reason /intake takes it —
  // a drop of GC paperwork IS the correspondence that capability names.
  "intake.recordIntakeDocument": {
    capability: "MANAGE_JOBS",
    reason:
      "Reached from /intake, which demands MANAGE_JOBS, and from the Ask panel on /dashboard and /ask, which refuse nobody at the route level. It already asserts MANAGE_JOBS, matching the only one of its three doors that demands anything; recorded here so that assertion is EXECUTED by the cases below rather than merely present in the source, which is what it was until now.",
  },
};

/* ---------------------------------------------------------------- *
 * 3b. The third shape: a page that withholds SEVERAL things
 * ---------------------------------------------------------------- */

/**
 * `SOFT_GATED_AMBIGUOUS` is where #392 stopped, and stopping there was
 * right — but it left the actions behind those pages VISIBLE AND
 * UNDECIDABLE, which is a better place than invisible and is not a
 * finished one.
 *
 * The shape, and why neither existing list fits it. `/jobs/[id]` renders
 * six sections and withholds three of them on VIEW_JOB_COSTS, two on
 * MANAGE_JOBS, and one on nothing at all. The page therefore has no single
 * answer to "which capability do the actions behind it assert", so
 * `effectiveCapability` yields `null` for it and `soleCapabilityGating`
 * yields `null` for everything it reaches.
 *
 *   - `KNOWN_OPEN` does not fit: that list is keyed on a capability the
 *     ordinary rule DID derive and the action fails to assert. Here the
 *     rule derives nothing.
 *   - `MIXED_DOORS` does not fit either, and this is the subtle one: its
 *     staleness check requires the doors to actually DISAGREE
 *     (`capabilities.size < 2` is reported as stale). Six of the entries
 *     below have exactly ONE door. Their doors do not disagree — there is
 *     simply more than one gate on the single page they sit behind. A
 *     MIXED_DOORS entry for them would be reported stale the day it was
 *     written.
 *
 * So the decision is recorded per SECTION instead, because the section is
 * the thing that actually withholds. `section` names the heading in the
 * page source the action's own form sits inside, so a reviewer can check
 * the claim against the file rather than taking it on trust, and so a
 * later reshuffle of that page has something specific to invalidate.
 *
 * TWO OF THE SECTIONS NAMED BELOW WITHHOLD NOTHING, and that is stated
 * rather than smoothed over. "Schedule" on the Overview tab and "Field
 * time entries" on Crew & time render for anyone who can open the job. For
 * those the capability is NOT read off the page — it is the one the
 * matching Ask command already declares for the very same action, which is
 * the second half of the rule #392 established with `log_payment` and is
 * the only derivation available when the page itself says nothing. Where
 * that is the source, the entry says so and names the command.
 */
const SECTION_DECIDED: Record<
  string,
  { capability: Capability; section: string; reason: string }
> = {
  /* ---- /jobs/[id] — the Overview tab ---- */

  // The "Schedule" section. No wrapper: it renders for every job function.
  // MANAGE_JOBS comes from the Ask side, where this exact action is already
  // offered under it.
  "jobs.updateJobSchedule": {
    capability: "MANAGE_JOBS",
    section: "Schedule",
    reason:
      "The Schedule section of the Overview tab withholds nothing, so the page cannot supply a capability. The `reschedule_job` Ask command declares MANAGE_JOBS and names `action: \"updateJobSchedule\"` — this very function — so the capability is read from the surface that already decided it rather than invented here. Its own doc comment gives the reasoning too: MANAGE_JOBS is \"jobs themselves\". ACCOUNTING and PAYROLL_COMPLIANCE are the only functions that lose the form, and neither schedules work.",
  },
  "jobs.assignCrewMember": {
    capability: "MANAGE_JOBS",
    section: "Schedule — Crew",
    reason:
      "Same ungated section as updateJobSchedule, and the same capability for the same reason: staffing a job is the job record itself, and it is written as a JobAssignment on Job. FIELD holds MANAGE_JOBS, which is the point — the foreman who runs the crew must keep this. There is no Ask command for it (lib/ask/commands/estimating.ts excludes it by name), so the sibling control in its own section is the derivation.",
  },
  "jobs.unassignCrewMember": {
    capability: "MANAGE_JOBS",
    section: "Schedule — Crew",
    reason:
      "The other half of assignCrewMember, in the same ungated section, taking the same capability. Excluded from the Ask commands by name with the reason that removing somebody from a roster is done where the roster is shown — which is this section.",
  },

  // The "Contract signature" and "Subcontract agreement" sections, both
  // wrapped in `showsJobMoney`. The derivation here is the ordinary one:
  // the capability the section withholds on.
  "billing.createSignatureRequest": {
    capability: "VIEW_JOB_COSTS",
    section: "Contract signature",
    reason:
      "Inside `{showsJobMoney && (…)}` on the Overview tab, which is `can(principal, \"VIEW_JOB_COSTS\")`. Not invented and not novel: `docusign.ts`'s sendWithDocuSign, refreshDocuSignEnvelope and voidSentEnvelope are rendered by DocuSignPanel INSIDE this very section and already assert VIEW_JOB_COSTS. Three actions in one section asserting it and two not was the inconsistency.",
  },
  "billing.revokeSignatureRequest": {
    capability: "VIEW_JOB_COSTS",
    section: "Contract signature",
    reason:
      "Same section, same gate, same DocuSign precedent as createSignatureRequest. It kills a live e-sign link a client may be holding, so leaving it as the one control in a withheld section that answers anyone was the worse half of the pair.",
  },
  "billing.uploadContractDocument": {
    capability: "VIEW_JOB_COSTS",
    section: "Subcontract agreement",
    reason:
      "Inside the second `{showsJobMoney && (…)}` section. The uploaded file is the GC-to-sub agreement — the evidence that made the job billable — and a new version is how an amendment is recorded, so it is the contract's paper trail rather than a field document.",
  },
  "billing.deleteContractDocument": {
    capability: "VIEW_JOB_COSTS",
    section: "Subcontract agreement",
    reason:
      "Same section as uploadContractDocument. It already calls assertOwner, and the capability is asserted BEFORE it for the reason #392 gives for the QuickBooks pushes: an owner check only stands in for a capability while the role model has two values, and the message a refused person needs is the one naming the thing they cannot do. It also deletes the blob, so nothing about it is recoverable.",
  },

  /* ---- /jobs/[id]/crew — the Crew & time tab ---- */

  // The "Field time entries" section. Ungated, exactly as the page's own
  // doc comment says it has always been. MANAGE_FIELD comes from the Ask
  // command, which calls `logTimeEntry` directly.
  "labor.logTimeEntry": {
    capability: "MANAGE_FIELD",
    section: "Field time entries",
    reason:
      "The section withholds nothing, so the capability is the one the `log_time_entry` Ask command declares — MANAGE_FIELD — and that command imports and calls this exact function from lib/actions/labor.ts, so the two surfaces now agree rather than one being open. Its second door, /settings/assistant, demands MANAGE_COMPLIANCE only because it imports the Ask command registry to list proposals; there is no time form on it. Identical shape to #392's logPayment. MANAGE_FIELD's own doc comment names \"time\".",
  },
  "labor.updateTimeEntry": {
    capability: "MANAGE_FIELD",
    section: "Field time entries",
    reason:
      "Corrects an entry logTimeEntry created, in the same section, so it takes the same capability. Correcting hours is deliberately not available from Ask (the command's own description says corrections are done on the job page), which is why the command cannot be the source here and the sibling it corrects is.",
  },
  "labor.deleteTimeEntry": {
    capability: "MANAGE_FIELD",
    section: "Field time entries",
    reason:
      "Removes an entry from the same section. Hours are what certified payroll and a delay claim are argued from, so of the three this is the one where answering anyone signed in mattered most. Same capability as the create it reverses — a delete is not looser than the write it undoes.",
  },
  // The "Union hiring-hall dispatch" section. Also ungated. No Ask command
  // exists, so the capability is argued from the page and from the
  // capability doc comments, and the argument is written out because it is
  // the one genuinely arguable call in this pass.
  "labor.uploadDispatchSlip": {
    capability: "MANAGE_FIELD",
    section: "Union hiring-hall dispatch",
    reason:
      "Arguable against MANAGE_COMPLIANCE, and called MANAGE_FIELD deliberately, on ROUTE_CAPABILITY's own stated reasoning for /certifications: PAYROLL_COMPLIANCE holds BOTH capabilities, so nobody who would own this under the compliance reading loses it under this one, while FIELD and PROJECT_MANAGER hold only MANAGE_FIELD and would lose a control they use today. The slip is the staffing record the time entries above it are logged against, on the crew tab, beside them. Reading it as compliance paperwork would take it from the people who receive it.",
  },
  "labor.deleteDispatchSlip": {
    capability: "MANAGE_FIELD",
    section: "Union hiring-hall dispatch",
    reason:
      "Same section and the same capability as the upload it reverses, for the same reason. Nothing is sent to the local either way; the row and the link to any scanned slip are this company's own record of the referral.",
  },

  /* ---- Ten that ALREADY assert the right capability, and which this
   * file has never once executed.
   *
   * These change no behaviour whatsoever. They are here because the
   * enumeration above found them and they are the more interesting half of
   * what it found: every one already carries the guard its section wants,
   * and every one was reached ONLY through a page withholding several
   * capabilities — so `soleCapabilityGating` returned `null`, they never
   * entered MUST_ASSERT, and no case in section 5 ever called them. A
   * correct guard that nothing exercises is one careless edit from being
   * an incorrect guard that nothing exercises, and this suite would have
   * stayed green through it.
   *
   * Recording them here costs nothing and buys the execution: each is now
   * called as every job function lacking the capability, must refuse
   * before touching the database, and must admit everyone holding it plus
   * an OWNER. That is the difference between "the source contains the
   * string" and "the endpoint refuses the person". ---- */

  // Rendered by DocuSignPanel INSIDE the Overview tab's two
  // `{showsJobMoney && …}` sections, and reachable from the Estimate tab,
  // which withholds its whole body on the same capability.
  "docusign.sendWithDocuSign": {
    capability: "VIEW_JOB_COSTS",
    section: "Contract signature / Subcontract agreement (DocuSignPanel)",
    reason:
      "Already asserts VIEW_JOB_COSTS and has since it was written; recorded so that it is EXECUTED. Its two doors are the Overview tab — which withholds several capabilities section by section, so the ordinary rule derives nothing from it — and the Estimate tab. Both withhold these sections on VIEW_JOB_COSTS. No behaviour change.",
  },
  "docusign.refreshDocuSignEnvelope": {
    capability: "VIEW_JOB_COSTS",
    section: "Contract signature / Subcontract agreement (DocuSignPanel)",
    reason:
      "Same panel, same two doors and same capability as sendWithDocuSign, already asserted. Recorded so it is executed rather than merely believed. No behaviour change.",
  },
  "docusign.voidSentEnvelope": {
    capability: "VIEW_JOB_COSTS",
    section: "Contract signature / Subcontract agreement (DocuSignPanel)",
    reason:
      "Same panel and capability as sendWithDocuSign, already asserted, and it additionally refuses anyone who is not the owner. Recorded so the capability half is executed; the owner half is the panel's own `canVoid` and is a separate axis. No behaviour change.",
  },

  // The Overview tab's `{showsJobManagement && …}` sections — "Job
  // details" and "Job status" — where showsJobManagement is
  // can(principal, "MANAGE_JOBS").
  "jobDetails.updateJobDetails": {
    capability: "MANAGE_JOBS",
    section: "Job details",
    reason:
      "Already asserts MANAGE_JOBS, which is exactly what its `{showsJobManagement && …}` section withholds on. Recorded so it is executed: the Overview tab's several gates meant this never entered the derived set and no case here ever called it. No behaviour change.",
  },
  "jobDetails.deleteEstimateJob": {
    capability: "MANAGE_JOBS",
    section: "Job details",
    reason:
      "Same section and capability as updateJobDetails, already asserted, plus an owner check of its own — the form only offers it when `canRemove` is true. Recorded for execution, no behaviour change.",
  },
  "jobs.setJobStatus": {
    capability: "MANAGE_JOBS",
    section: "Job status",
    reason:
      "Already asserts MANAGE_JOBS, the capability its own `{showsJobManagement && …}` section withholds on. Worth executing rather than reading: a job's status is the single most GC-visible field on the record, and this is the only control that moves it. No behaviour change.",
  },
  "jobs.recordExecutedSubcontract": {
    capability: "MANAGE_JOBS",
    section: "Contract signature — Record executed subcontract",
    reason:
      "Nested inside BOTH gates: the `{showsJobMoney && …}` section, and then `{!isContractExecuted && showsJobManagement && …}` around the control itself. MANAGE_JOBS is the inner and narrower of the two, which is what it already asserts, so the recorded capability is the one actually reached. No behaviour change.",
  },

  // The Crew & time tab's timesheet approval, whose control is passed
  // `canApprove={can(principal, "MANAGE_COMPLIANCE")}`.
  "timesheetSignoff.approveTimesheetDay": {
    capability: "MANAGE_COMPLIANCE",
    section: "Timesheet sign-off",
    reason:
      "Already asserts MANAGE_COMPLIANCE, matching the `canApprove` flag the crew page computes for this exact control. Deliberately NOT the MANAGE_FIELD the rest of that tab takes: approving a signed day turns it into payroll, and the foreman who signed it is not who agrees it. Recorded for execution, no behaviour change.",
  },
  "timesheetSignoff.reopenTimesheetDay": {
    capability: "MANAGE_COMPLIANCE",
    section: "Timesheet sign-off",
    reason:
      "The other half of approveTimesheetDay, same control, same capability, already asserted. Reopening unlocks a day's hours for editing, so it is if anything the more consequential of the two. Recorded for execution, no behaviour change.",
  },
};

/**
 * The other half of the same set: actions behind a page that withholds
 * several capabilities which this pass did NOT decide.
 *
 * This list exists so that "not decided" is a line somebody wrote rather
 * than a silence, which is the whole rule this feature is built on. The
 * check below requires every action behind an ambiguous page to be in
 * exactly one of these two maps — so the next pass starts from a set it
 * can count instead of re-deriving one, and a NEW action wired to
 * `/contacts/[id]` or `/dashboard` fails this suite until somebody either
 * decides it or writes down why not.
 *
 * IT MAY ONLY SHRINK, for the same reason `KNOWN_OPEN` may only shrink.
 */
const UNDECIDED_BEHIND_AN_AMBIGUOUS_PAGE: Record<string, { page: string; reason: string }> = {
  // `/contacts/[id]` withholds on three capabilities section by section
  // (MANAGE_ESTIMATING for bid invitations, MANAGE_BILLING for the client
  // portal, VIEW_JOB_COSTS elsewhere). That is a bigger per-section read
  // than this pass took on, and the CRM half is a different lane
  // (WORK-SPLIT.md, the fourth lane) whose actions want announcing before
  // they are touched. Deciding three of thirteen would leave the page
  // partly enforced, which this file already argues about /closeout is
  // harder to reason about than a consistent state.
  "company.updateContact": { page: "/contacts/[id]", reason: "The contact record itself, reached from a page withholding three different capabilities section by section. Not decided in this pass; wants the whole page read at once rather than one action at a time." },
  "crm.createContactInteraction": { page: "/contacts/[id]", reason: "CRM interaction log — the fourth lane's feature (WORK-SPLIT.md), gated on the page behind MANAGE_ESTIMATING. Announce before touching; not decided here." },
  "crm.updateContactInteraction": { page: "/contacts/[id]", reason: "The same People/Interactions section and the same fourth lane as createContactInteraction; it edits a row that action created, so the two are decided together or not at all." },
  "crm.deleteContactInteraction": { page: "/contacts/[id]", reason: "Same section and same lane as createContactInteraction. Not an evidence record by its own feature's decision — any team member may delete one." },
  "crm.createContactPerson": { page: "/contacts/[id]", reason: "The People section of the CRM contact page, same lane and same per-section question as the interaction log." },
  "crm.updateContactPerson": { page: "/contacts/[id]", reason: "The same People section and the same fourth lane as createContactPerson; it edits a row that action created, so the two are decided together or not at all." },
  "crm.deleteContactPerson": { page: "/contacts/[id]", reason: "The same People section and the same fourth lane as createContactPerson. Removing a person from an account is not an evidence deletion — that feature decided any team member may do it — so it carries no extra weight of its own." },
  "estimating.createBidInvitation": { page: "/contacts/[id]", reason: "Bid invitations sit in a MANAGE_ESTIMATING section of this page, so the derivation is probably easy — but `/bids` and `/pipeline` read the same rows under the same capability and #79 is in flight on `/bids` right now. Left for a pass that can take the three surfaces together." },
  "estimating.deleteBidInvitation": { page: "/contacts/[id]", reason: "Same section as createBidInvitation, same reason for leaving it." },
  "estimating.updateBidInvitationStatus": { page: "/contacts/[id]", reason: "Same section as createBidInvitation. This is the one of the three that changes a status the GC's invitation is tracked by, so it is the first thing the next pass should take." },
  "billing.enablePortalAccess": { page: "/contacts/[id]", reason: "Grants a client contact access to the portal — an outward-facing grant, and the highest-risk item on this page. Deliberately NOT swept in with the crew and contract work: a grant of access to somebody outside the company deserves its own argument and its own click-through, not a line in a batch." },
  "billing.revokeClientPortalAccess": { page: "/contacts/[id]", reason: "The other half of enablePortalAccess; goes with it, whichever way that one is decided." },
  "quickbooks.linkContactToQuickBooks": { page: "/contacts/[id]", reason: "Links a contact to a QuickBooks customer. MANAGE_BILLING is the likely answer given every other QuickBooks action, but its door is this page rather than /settings, so it is a per-section read this pass did not do." },

  // `/dashboard` withholds its money tiles on VIEW_JOB_COSTS and
  // MANAGE_BILLING. Everything below is reached from it.
  "ask.cancelAskProposal": { page: "/dashboard", reason: "An Ask card action, also reached from /ask, which withholds nothing. Its guard is not capability-shaped: what it should ask is whether the card's own command is one this person could run (canRunCommand), which follows the card rather than the page. Same argument this file already records for settleAskDraft, and the same lane." },
  "ask.confirmAskProposal": { page: "/dashboard", reason: "Same as cancelAskProposal — and it already refuses anyone lacking the command's declared capability in a returned sentence, per lib/ask/commands/schedule.ts's own note, so a page-derived capability on top would be the wrong boundary rather than a missing one." },
  "ask.loadAskProposal": { page: "/dashboard", reason: "Same as cancelAskProposal. A read of a card the asking person already owns." },
  "ask.prepareAskAttachment": { page: "/dashboard", reason: "Same as cancelAskProposal, in the Ask lane. It prepares an attachment for a card the asking person already owns, so what should guard it is the card's own command rather than the page the card was opened on." },
  "gettingStarted.hideGettingStarted": { page: "/dashboard", reason: "A per-person preference write — it hides a panel on the person's own dashboard and touches no job, no money and nothing a GC sees. Explicitly the lowest-risk category in this sweep and left for last on purpose. Recorded rather than fixed so that the count stays honest." },
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

  it("accounts for every page that withholds content, not only every page that refuses the route", () => {
    // THE SIZE ASSERTION, and the reason it is an equality rather than a
    // floor. Both sets below are DERIVED by pattern; `PAGES_THAT_WITHHOLD`
    // is counted by a different literal. A pattern that matches nothing
    // leaves both derived sets empty and every downstream "no holes
    // found" assertion vacuously true — so the parse is required to
    // classify exactly as many pages as the independent count found, and
    // a silent shrink fails HERE with both numbers on screen.
    expect(
      SOFT_GATED.size + SOFT_GATED_AMBIGUOUS.size,
      `${PAGES_THAT_WITHHOLD.length} pages withhold content behind a capability and this walk ` +
        `classified ${SOFT_GATED.size + SOFT_GATED_AMBIGUOUS.size}. A page that withholds and is ` +
        `classified as neither is invisible to every check below.`,
    ).toBe(PAGES_THAT_WITHHOLD.length);

    // And it must have found SOMETHING. An equality between two empty
    // sets is the exact failure the paragraph above describes.
    expect(PAGES_THAT_WITHHOLD.length).toBeGreaterThanOrEqual(9);
    expect(SOFT_GATED.size).toBeGreaterThanOrEqual(5);

    // Named, because a count is not a claim about WHICH. These three are
    // the tabs issue #383 is about: each returns a single sentence and
    // nothing else to a person lacking the capability.
    expect(SOFT_GATED.get("/jobs/[id]/billing")).toBe("MANAGE_BILLING");
    expect(SOFT_GATED.get("/jobs/[id]/retainage")).toBe("MANAGE_BILLING");
    expect(SOFT_GATED.get("/jobs/[id]/estimate")).toBe("VIEW_JOB_COSTS");
    // The bid wizard's pricing step, which withholds the same way through
    // a direct `can(principal, …)` rather than through `jobCapabilities`.
    expect(SOFT_GATED.get("/jobs/new/[jobId]/items")).toBe("VIEW_JOB_COSTS");

    // A page withholding two different things stays undecidable, and that
    // is a decision rather than an oversight: `/jobs/[id]` hides money and
    // management sections separately, so "which capability do the actions
    // behind it answer to" has no single answer to read off the file.
    expect(SOFT_GATED_AMBIGUOUS.get("/jobs/[id]")).toEqual(["MANAGE_JOBS", "VIEW_JOB_COSTS"]);
    expect(SOFT_GATED.has("/jobs/[id]")).toBe(false);

    // A hard gate still wins over a soft one on the same page.
    expect(effectiveCapability("/jobs/[id]/photos")).toBe("MANAGE_FIELD");
    expect(effectiveCapability("/jobs/[id]/field-reports")).toBeNull();
  });
});

/** The pages reaching this action that withhold more than one capability.
 * Empty for almost everything; non-empty is what makes an action a
 * per-section judgement rather than a derivation. */
function ambiguousDoors(action: string): string[] {
  const doors = reachedBy.get(action);
  if (!doors) return [];
  return [...doors.keys()].filter((route) => SOFT_GATED_AMBIGUOUS.has(route)).sort();
}

/** Every action whose doors agree on one capability, and which must
 * therefore assert it. Derived, never typed out — except for the
 * per-section decisions, which cannot be derived and are checked against
 * the code by the same execution cases as everything else. */
const MUST_ASSERT: { action: string; moduleName: string; capability: Capability }[] = [];
for (const action of [...reachedBy.keys()].sort()) {
  const moduleName = definingModule.get(action) as string;
  const key = `${moduleName}.${action}`;
  const mixed = MIXED_DOORS[key];
  const decided = SECTION_DECIDED[key];
  const capability = mixed
    ? mixed.capability
    : decided
      ? decided.capability
      : soleCapabilityGating(action);
  if (!capability) continue;
  if (!mixed && !decided && key in KNOWN_OPEN) continue;
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

  it("accounts for every action behind a page that withholds several capabilities", () => {
    // THE COMPLETENESS ASSERTION for the third shape, and the reason it is
    // the same kind of check as the size assertion above rather than a
    // list somebody maintains: an action reached from `/jobs/[id]` or
    // `/contacts/[id]` gets `null` out of `soleCapabilityGating`, which is
    // indistinguishable from "no page reaches it" everywhere downstream.
    // Every "no holes found" assertion in this file passes over it. So the
    // set is enumerated FROM THE WALK and each member is required to be in
    // exactly one of the two decision maps.
    //
    // Add a form to one of those pages and this fails by name until
    // somebody either gates the action or writes down why not. That is the
    // difference between debt and a blind spot, and it is the whole reason
    // this block exists rather than a comment saying the work is unfinished.
    const undecidedByTheOrdinaryRule = [...reachedBy.keys()]
      .filter((action) => ambiguousDoors(action).length > 0)
      .filter((action) => soleCapabilityGating(action) === null)
      .map((action) => `${definingModule.get(action)}.${action}`)
      .filter((key) => !(key in MIXED_DOORS) && !(key in KNOWN_OPEN))
      .sort();

    // It must have found something, or the two assertions below are
    // vacuously true — the failure mode this whole file is shaped around.
    expect(
      undecidedByTheOrdinaryRule.length,
      `No action was found behind a page that withholds several capabilities. Either every one ` +
        `has been decided (delete this block and SOFT_GATED_AMBIGUOUS with it) or the walk has ` +
        `stopped seeing them, which is what it looks like when a page's gate stops matching.`,
    ).toBeGreaterThanOrEqual(18);

    const unaccounted = undecidedByTheOrdinaryRule.filter(
      (key) => !(key in SECTION_DECIDED) && !(key in UNDECIDED_BEHIND_AN_AMBIGUOUS_PAGE),
    );
    expect(
      unaccounted,
      `These Server Actions sit behind a page that withholds SOME of its content, and this file ` +
        `can say nothing about them:\n` +
        unaccounted.map((k) => `  ${k}`).join("\n") +
        `\n\nThe ordinary rule cannot decide them — the page has more than one gate, so there is ` +
        `no single capability to read off it. Read which SECTION the action's own form sits ` +
        `inside and record it in SECTION_DECIDED, or record in ` +
        `UNDECIDED_BEHIND_AN_AMBIGUOUS_PAGE why it is being left. Absence is not a decision.`,
    ).toEqual([]);

    // Neither map may claim an action the other does, and neither may hold
    // a line that is no longer true.
    const both = Object.keys(SECTION_DECIDED).filter(
      (key) => key in UNDECIDED_BEHIND_AN_AMBIGUOUS_PAGE,
    );
    expect(both, `Recorded as both decided and undecided: ${both.join(", ")}`).toEqual([]);

    const wrong: string[] = [];
    for (const [key, decision] of Object.entries(SECTION_DECIDED)) {
      const action = key.split(".")[1];
      if (definingModule.get(action) !== key.split(".")[0]) {
        wrong.push(`${key} — no such action in that module any more`);
        continue;
      }
      if (ambiguousDoors(action).length === 0) {
        wrong.push(
          `${key} — no page reaching it withholds several capabilities any more, so the ` +
            `ordinary rule decides it; delete this entry`,
        );
      }
      if (!assertsCapability(action, decision.capability)) {
        wrong.push(`${key} — recorded as ${decision.capability} and does not assert it`);
      }
      // A section name that says nothing cannot be checked against the
      // page, which is the only thing making this a decision rather than
      // a preference.
      expect(decision.section.length).toBeGreaterThan(4);
      expect(decision.reason.length).toBeGreaterThan(80);
    }
    for (const [key, entry] of Object.entries(UNDECIDED_BEHIND_AN_AMBIGUOUS_PAGE)) {
      const action = key.split(".")[1];
      if (definingModule.get(action) !== key.split(".")[0]) {
        wrong.push(`${key} — no such action in that module any more`);
        continue;
      }
      if (!ambiguousDoors(action).includes(entry.page)) {
        wrong.push(`${key} — is not reached from ${entry.page} any more`);
      }
      for (const capability of CAPABILITIES) {
        if (assertsCapability(action, capability)) {
          wrong.push(`${key} — recorded as undecided and now asserts ${capability}; the debt is paid, delete this line`);
        }
      }
      expect(entry.reason.length).toBeGreaterThan(60);
    }
    expect(wrong, `The per-section decisions no longer match the code:\n${wrong.join("\n")}`).toEqual([]);
  });

  it("still covers the whole surface this pass claimed to close", () => {
    // A blunt count, because every check above is a "nothing is wrong"
    // assertion and those all pass on an empty set. If a future change
    // unwires a page from its actions, the holes list stays empty and the
    // suite would go quiet about thirty-five real endpoints.
    expect(MUST_ASSERT.length).toBeGreaterThanOrEqual(87);

    const byCapability = (capability: Capability) =>
      MUST_ASSERT.filter((entry) => entry.capability === capability).map((e) => e.action);

    // The two capabilities that gated nothing at all.
    expect(byCapability("MANAGE_FIELD").length).toBeGreaterThanOrEqual(16);
    expect(byCapability("MANAGE_JOBS").length).toBeGreaterThanOrEqual(17);

    // The two the soft-gate pass added, and the reason they are named
    // rather than only counted: every one of these is a MONEY write that
    // was reachable by anyone signed in, because its only door refused
    // people by rendering a sentence instead of by refusing the route.
    expect(byCapability("VIEW_JOB_COSTS").length).toBeGreaterThanOrEqual(25);
    expect(byCapability("MANAGE_BILLING").length).toBeGreaterThanOrEqual(11);
    for (const action of ["createInvoice", "logPayment", "deletePayment", "submitPayApplication"]) {
      expect(byCapability("MANAGE_BILLING")).toContain(action);
    }
    for (const action of ["addCostEntry", "addLineItem", "approveChangeOrder", "markJobContracted"]) {
      expect(byCapability("VIEW_JOB_COSTS")).toContain(action);
    }

    // The two deletes that had no guard of any kind — not owner, not
    // capability — named here so they can never fall out silently.
    expect(byCapability("MANAGE_FIELD")).toContain("deleteDailyFieldReport");
    expect(byCapability("MANAGE_FIELD")).toContain("deleteMaterialDelivery");
  });

  it("gives the money writes the capability their own tab withholds, and says which", () => {
    // An INDEPENDENT expectation table for the set issue #383 names, written
    // out by hand on purpose. Everything else in this file is derived, which
    // is what makes it catch omissions — and is also why, on its own, it
    // cannot catch a DERIVATION that has quietly changed its mind. Soften
    // `/jobs/[id]/billing`'s gate from MANAGE_BILLING to something laxer and
    // every derived check above still passes, because the actions would be
    // asserting whatever the page now says. This table disagrees instead.
    //
    // It is small deliberately: the money surface, not the whole app.
    const EXPECTED: Record<string, Capability> = {
      // /jobs/[id]/billing — withheld on MANAGE_BILLING
      "billing.createInvoice": "MANAGE_BILLING",
      "billing.submitPayApplication": "MANAGE_BILLING",
      "billing.updateInvoiceStatus": "MANAGE_BILLING",
      "billing.logPayment": "MANAGE_BILLING",
      "billing.deletePayment": "MANAGE_BILLING",
      "quickbooks.pushInvoiceToQuickBooks": "MANAGE_BILLING",
      "quickbooks.pushPaymentToQuickBooks": "MANAGE_BILLING",
      // /jobs/[id]/retainage — withheld on MANAGE_BILLING
      "billing.createRetainageRelease": "MANAGE_BILLING",
      "billing.deleteRetainageRelease": "MANAGE_BILLING",
      "billing.updateJobRetainageTerms": "MANAGE_BILLING",
      // /jobs/[id]/estimate (+ the bid wizard's pricing step) — VIEW_JOB_COSTS
      "jobs.addLineItem": "VIEW_JOB_COSTS",
      "jobs.updateLineItem": "VIEW_JOB_COSTS",
      "jobs.updateLineItemForecast": "VIEW_JOB_COSTS",
      "jobs.deleteLineItem": "VIEW_JOB_COSTS",
      "takeoff.addTakeoffLines": "VIEW_JOB_COSTS",
      "jobs.draftLineItemsFromScope": "VIEW_JOB_COSTS",
      "jobs.addCostEntry": "VIEW_JOB_COSTS",
      "jobs.deleteCostEntry": "VIEW_JOB_COSTS",
      "jobs.markJobContracted": "VIEW_JOB_COSTS",
      "estimating.addLineItemFromCatalog": "VIEW_JOB_COSTS",
      "estimating.saveEstimateVersion": "VIEW_JOB_COSTS",
      "estimating.saveLineItemAsCatalogEntry": "VIEW_JOB_COSTS",
      "billing.generateJobWipNarrative": "VIEW_JOB_COSTS",
      "changeOrders.createChangeOrder": "VIEW_JOB_COSTS",
      "changeOrders.proposeAddedScope": "VIEW_JOB_COSTS",
      "changeOrders.proposeLineItemChange": "VIEW_JOB_COSTS",
      "changeOrders.proposeScopeRemoval": "VIEW_JOB_COSTS",
      "changeOrders.removeProposal": "VIEW_JOB_COSTS",
      "changeOrders.deleteChangeOrderDraft": "VIEW_JOB_COSTS",
      "changeOrders.submitChangeOrder": "VIEW_JOB_COSTS",
      "changeOrders.approveChangeOrder": "VIEW_JOB_COSTS",
      "changeOrders.rejectChangeOrder": "VIEW_JOB_COSTS",
      "changeOrders.voidChangeOrder": "VIEW_JOB_COSTS",
      "changeOrders.reopenChangeOrder": "VIEW_JOB_COSTS",
      "changeOrders.reviseChangeOrder": "VIEW_JOB_COSTS",
    };

    const derived = new Map(MUST_ASSERT.map((e) => [`${e.moduleName}.${e.action}`, e.capability]));
    for (const [key, capability] of Object.entries(EXPECTED)) {
      expect(
        derived.get(key),
        `${key} should answer to ${capability}. If the walk now derives something else, the ` +
          `page it sits behind has changed what it withholds — decide which is right rather ` +
          `than editing whichever of the two is easier.`,
      ).toBe(capability);
      // And it must really be in the source, not merely expected to be.
      expect(assertsCapability(key.split(".")[1], capability)).toBe(true);
    }

    // The one money-shaped action in this set that is deliberately NOT
    // gated, recorded here so the absence stays a decision. It drafts a
    // change order from a delay the foreman logged, on a tab that
    // withholds nothing; nothing before APPROVED moves a contract value,
    // and every step that does is in the table above.
    expect(derived.has("changeOrders.draftChangeOrderFromDelay")).toBe(false);
    for (const capability of CAPABILITIES) {
      expect(assertsCapability("draftChangeOrderFromDelay", capability)).toBe(false);
    }
  });

  it("gives each Overview and Crew write the capability of the section it sits in", () => {
    // The same independent hand-written table as the money one above, for
    // the set this pass decided, and it earns its place for a DIFFERENT
    // reason here. The money table's job was to catch a page quietly
    // changing what it withholds. These twelve are not derived from a page
    // at all — six sit inside a section that withholds nothing — so
    // without this table the only record of the decision would be the
    // guard itself, and a guard agrees with whatever it says.
    //
    // Two sources, kept apart on purpose, because they are not equally
    // strong: a section's own `showsJobMoney` wrapper is read off the
    // file, while an Ask command's declared capability is a decision
    // somebody made elsewhere and this pass is deferring to.
    const FROM_THE_SECTIONS_OWN_GATE: Record<string, Capability> = {
      // Overview → `{showsJobMoney && …}` → can(principal, "VIEW_JOB_COSTS")
      "billing.createSignatureRequest": "VIEW_JOB_COSTS",
      "billing.revokeSignatureRequest": "VIEW_JOB_COSTS",
      "billing.uploadContractDocument": "VIEW_JOB_COSTS",
      "billing.deleteContractDocument": "VIEW_JOB_COSTS",
    };
    const FROM_THE_MATCHING_ASK_COMMAND: Record<string, Capability> = {
      // reschedule_job declares MANAGE_JOBS and names updateJobSchedule.
      "jobs.updateJobSchedule": "MANAGE_JOBS",
      // log_time_entry declares MANAGE_FIELD and calls logTimeEntry.
      "labor.logTimeEntry": "MANAGE_FIELD",
    };
    const FROM_A_SIBLING_IN_THE_SAME_SECTION: Record<string, Capability> = {
      "jobs.assignCrewMember": "MANAGE_JOBS",
      "jobs.unassignCrewMember": "MANAGE_JOBS",
      "labor.updateTimeEntry": "MANAGE_FIELD",
      "labor.deleteTimeEntry": "MANAGE_FIELD",
      "labor.uploadDispatchSlip": "MANAGE_FIELD",
      "labor.deleteDispatchSlip": "MANAGE_FIELD",
    };

    const derived = new Map(MUST_ASSERT.map((e) => [`${e.moduleName}.${e.action}`, e.capability]));
    for (const table of [
      FROM_THE_SECTIONS_OWN_GATE,
      FROM_THE_MATCHING_ASK_COMMAND,
      FROM_A_SIBLING_IN_THE_SAME_SECTION,
    ]) {
      for (const [key, capability] of Object.entries(table)) {
        expect(
          derived.get(key),
          `${key} should answer to ${capability}. Every one of these is a per-section decision ` +
            `recorded in SECTION_DECIDED, so a disagreement here means the recorded decision and ` +
            `the code have parted company — fix whichever is wrong, not whichever is nearer.`,
        ).toBe(capability);
        expect(assertsCapability(key.split(".")[1], capability)).toBe(true);
        // And it really is recorded as a section decision, not arriving
        // through some other route that happens to agree today.
        expect(SECTION_DECIDED[key]?.capability).toBe(capability);
      }
    }

    // The claim that makes the FIRST table's source real: the two Overview
    // sections it names withhold on VIEW_JOB_COSTS, and the page says so
    // itself. If that ever stops being true the four entries above are
    // quoting a gate that no longer exists.
    expect(SOFT_GATED_AMBIGUOUS.get("/jobs/[id]")).toEqual(["MANAGE_JOBS", "VIEW_JOB_COSTS"]);
    expect(SOFT_GATED_AMBIGUOUS.get("/jobs/[id]/crew")).toEqual([
      "MANAGE_COMPLIANCE",
      "MANAGE_FIELD",
    ]);

    // And the backcharge lifecycle, taken whole rather than in part so
    // `/backcharges` is not left half-enforced — this file's own argument
    // about `/closeout`, applied. Derived by the ordinary rule (one door,
    // one capability), so this only pins that all six were taken.
    for (const action of [
      "createBackcharge",
      "updateBackcharge",
      "disputeBackcharge",
      "resolveBackcharge",
      "reopenBackcharge",
      "deleteBackcharge",
    ]) {
      expect(derived.get(`backcharges.${action}`)).toBe("MANAGE_BILLING");
      expect(assertsCapability(action, "MANAGE_BILLING")).toBe(true);
    }
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
  // Only `updateCompanyProfile` — the rest of this module is either
  // reachable from ungated pages (/team, /contacts) or recorded in
  // KNOWN_OPEN. It is the first writer of `Company` this app has ever had,
  // and this suite found it by the walk on the day it was added, which is
  // the behaviour the file is for.
  company: () => import("./actions/company"),
  // The Jobber import's three actions: reachable only from
  // /settings/integrations, so they assert its MANAGE_COMPLIANCE before
  // the owner check and before anything is read.
  jobber: () => import("./actions/jobber"),
  // DocuSign: disconnect is reachable only from /settings/integrations, so
  // it asserts MANAGE_COMPLIANCE before the owner check. The send, refresh
  // and void actions are reached from /jobs/[id], which has no single page
  // capability; they assert VIEW_JOB_COSTS themselves — and as of this
  // pass that assertion is EXECUTED rather than taken on trust, via
  // SECTION_DECIDED. Only `disconnectDocuSign` reached the cases below
  // before.
  docusign: () => import("./actions/docusign"),
  // The Overview tab's "Job details" section. Both actions already
  // asserted MANAGE_JOBS and neither had ever been executed here, because
  // their only door withholds several capabilities. No behaviour change —
  // this is the module arriving in the derived set, not a new guard.
  jobDetails: () => import("./actions/jobDetails"),
  // The Crew & time tab's timesheet approval. Same story: both already
  // asserted MANAGE_COMPLIANCE, matching the `canApprove` flag that page
  // computes for this control, and neither had ever been called here.
  timesheetSignoff: () => import("./actions/timesheetSignoff"),
  // The QuickBooks import's two actions: reachable only from /settings, so
  // they assert its MANAGE_COMPLIANCE before the owner check and before
  // anything is read.
  quickbooksImport: () => import("./actions/quickbooksImport"),
  // Procore: the Integrations card's four (MANAGE_COMPLIANCE, then owner)
  // and the feed refresh on /rfis, /submittals and /drawings (MANAGE_JOBS)
  // — two modules because they sit behind two different doors.
  procore: () => import("./actions/procore"),
  procoreFeed: () => import("./actions/procoreFeed"),
  // ACC (Autodesk Construction Cloud): same two-door shape as Procore's —
  // the Integrations card's four (MANAGE_COMPLIANCE, then owner) and the
  // feed refresh on /rfis and /submittals (MANAGE_JOBS).
  acc: () => import("./actions/acc"),
  accFeed: () => import("./actions/accFeed"),
  // CompanyCam: the Integrations card's five (MANAGE_COMPLIANCE, then
  // owner) — the same door as Procore's, reachable only from
  // /settings/integrations.
  companycam: () => import("./actions/companycam"),
  // Bluebeam: the Integrations card's five (MANAGE_COMPLIANCE, then
  // owner) — the same door as CompanyCam's, reachable only from
  // /settings/integrations.
  bluebeam: () => import("./actions/bluebeam"),
  // The three money modules behind the job tabs, added when this walk
  // learned to read a soft gate (issue #383). Every action here is
  // reachable ONLY from `/jobs/[id]/estimate`, `/billing`, `/retainage`
  // or the bid wizard's pricing step — all of which withhold their whole
  // body behind one capability — so the derivation places them in
  // MUST_ASSERT and each is EXECUTED below as a principal without it.
  //
  // `billing` spans both: its invoice/payment/retainage writes answer to
  // MANAGE_BILLING, and `generateJobWipNarrative` to VIEW_JOB_COSTS,
  // because that is the capability the tab each one sits on withholds.
  billing: () => import("./actions/billing"),
  jobs: () => import("./actions/jobs"),
  changeOrders: () => import("./actions/changeOrders"),
  // Only the two PUSH actions: reachable from `/jobs/[id]/billing` alone.
  // The account-mapping and reconcile actions on `/settings` are a
  // different door and remain recorded in KNOWN_OPEN.
  quickbooks: () => import("./actions/quickbooks"),
  // Only the three estimate-tab writes; the catalog actions in the same
  // module sit behind `/catalog` and remain in KNOWN_OPEN.
  estimating: () => import("./actions/estimating"),
  // The generalized takeoff action. Reachable only from the estimate tab and
  // the bid wizard's pricing step — both withhold on VIEW_JOB_COSTS — so the
  // walk derives its assertion and executes it as a principal without it,
  // same as the jobs/estimating modules above.
  takeoff: () => import("./actions/takeoff"),
  // Crew & time. Five of the seven actions here are decided per SECTION
  // rather than per page (SECTION_DECIDED) — `/jobs/[id]/crew` withholds
  // on two capabilities, so the ordinary rule derives nothing for it. The
  // two prevailing-wage actions in the same module sit behind
  // `/jobs/[id]/compliance`, which withholds nothing at all, and are not
  // in this pass.
  labor: () => import("./actions/labor"),
  // Backcharges — a GC's deduction against what it owes us. All six
  // reachable only from `/backcharges`, which demands MANAGE_BILLING, so
  // the ordinary rule places all six and every one is executed below.
  backcharges: () => import("./actions/backcharges"),
  safety: () => import("./actions/safety"),
  certifications: () => import("./actions/certifications"),
  punchLists: () => import("./actions/punchLists"),
  equipment: () => import("./actions/equipment"),
  equipmentAssignments: () => import("./actions/equipmentAssignments"),
  fieldReports: () => import("./actions/fieldReports"),
  // Site photos. Only the two TAG-VOCABULARY actions land in MUST_ASSERT:
  // renaming and deleting a tag are reachable only from /photos, which
  // demands MANAGE_FIELD. The photo actions themselves — record, update,
  // delete, add/remove a tag on a photo, and now share/unshare with the
  // job's client — are also reachable from /jobs/[id], which demands no
  // capability, so their doors disagree and the derivation leaves them
  // alone. They assert MANAGE_FIELD anyway.
  //
  // `setJobMediaClientSharing` is the one of those with a consequence
  // outside the tenant, so its refusal IS executed rather than only read
  // off the source — in lib/job-media-sharing.dbtest.ts, which runs an
  // ACCOUNTING member at it and then a FIELD member as the control. It is
  // not listed in MIXED_DOORS because a single entry would make this module
  // half-enforced against five identical siblings, which this file's own
  // note on /closeout argues is worse than a consistent state.
  jobMedia: () => import("./actions/jobMedia"),
  materialOrders: () => import("./actions/materialOrders"),
  // Lien deadlines — every write reachable only from /lien-deadlines, which
  // demands MANAGE_BILLING, and every one asserts it before any query.
  lienDeadlines: () => import("./actions/lienDeadlines"),
  // The payroll register import and issuing a WH-347 payroll number —
  // both MANAGE_COMPLIANCE, deliberately NOT owner-only like the bulk
  // spreadsheet importers beside the register import on /settings/import.
  // See lib/actions/payrollRegister.ts's own doc comment for why.
  payrollRegister: () => import("./actions/payrollRegister"),
  // Phase codes — the company's own cost-coding vocabulary. All three
  // writes are reachable only from /settings, which demands
  // MANAGE_COMPLIANCE, so the walk puts all three in MUST_ASSERT and every
  // one is executed below as a principal without it. There is deliberately
  // no delete in that module: retiring is `isActive = false`, because a
  // phase code with priced work against it is the evidence of how work on
  // an already-invoiced job was coded.
  "phase-codes": () => import("./actions/phase-codes"),
  // The experience modification rate. All three writes are reachable only
  // from /compliance, which demands MANAGE_COMPLIANCE, so the walk puts all
  // three in MUST_ASSERT and each is executed below as a principal without
  // it — a FIELD foreman must not be able to post a mod rate a GC will read.
  emr: () => import("./actions/emr"),
  rfis: () => import("./actions/rfis"),
  submittals: () => import("./actions/submittals"),
  // setWorkerCraft is the first action in this module to assert its
  // capability; the rest are still on OPEN_BEHIND_AN_ALREADY_GUARDED_PAGE.
  unionCompliance: () => import("./actions/unionCompliance"),
  drawings: () => import("./actions/drawings"),
  closeout: () => import("./actions/closeout"),
  closeoutSubmissions: () => import("./actions/closeoutSubmissions"),
  // Document intake. All three actions are reachable only from /intake,
  // which demands MANAGE_JOBS, so the derivation puts all three in
  // MUST_ASSERT and every one of them is EXECUTED below as a principal
  // without it. That matters more here than on most modules: this one is
  // reached from an upload route as well as a page, and the file it records
  // a URL for is in a blob store shared by every tenant.
  intake: () => import("./actions/intake"),
  // The pre-bid pursuit list. All five actions are reachable only from
  // /pipeline, which demands MANAGE_ESTIMATING, so the walk put all five in
  // MUST_ASSERT on the day they were added — and each is executed below as
  // a principal without it.
  bidPursuits: () => import("./actions/bidPursuits"),
  // The Ask box. Only `checkAssistantConnection` lands in MUST_ASSERT: it
  // is reachable from /settings/assistant alone, which demands
  // MANAGE_COMPLIANCE. The card actions (confirm, cancel, settle, load)
  // are reachable from the dashboard, which demands nothing, so their
  // doors disagree and the derivation leaves them to their own guards.
  ask: () => import("./actions/ask"),
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
