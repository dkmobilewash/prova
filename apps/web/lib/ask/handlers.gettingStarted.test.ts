import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/lib/permissions";

/**
 * getting_started — the dashboard's getting-started card, through the card's
 * OWN loader and the card's OWN pure function.
 *
 * The fake database holds three companies and actually applies every where
 * clause, so a handler that dropped `companyId` (or asked about the wrong
 * one) counts somebody else's rows and ticks a brand-new account's boxes —
 * the assertions below go red on exactly that. The busy company is the
 * neighbour on purpose.
 *
 * "Matches the card" is checked two ways, because either alone is weak:
 * against `gettingStartedChecklist` called directly with the same counts
 * (so a handler that decided "done" or "shown" for itself disagrees), AND
 * against hand-written expectations for a half-set-up company (so a change
 * that broke both sides the same way is still caught).
 */

type Row = Record<string, unknown>;

const { tables, cookieJar, companyCalls } = vi.hoisted(() => {
  const many = (companyId: string, n: number, extra: Row = {}) =>
    Array.from({ length: n }, (_, i) => ({ id: `${companyId}-${i}`, companyId, ...extra }));
  const tables: Record<string, Row[]> = {
    company: [
      { id: "co-new", name: "Dana Smith's Company" },
      { id: "co-busy", name: "Halvorsen Drywall LLC" },
      { id: "co-mid", name: "Rossi Plaster" },
    ],
    job: [...many("co-busy", 4), ...many("co-mid", 1)],
    user: [...many("co-new", 1), ...many("co-busy", 6), ...many("co-mid", 1)],
    invite: [...many("co-busy", 2)],
    crewMember: [
      ...many("co-new", 1, { archivedAt: new Date("2026-01-01T00:00:00Z") }),
      ...many("co-busy", 3, { archivedAt: null }),
      ...many("co-mid", 1, { archivedAt: new Date("2026-02-01T00:00:00Z") }),
    ],
    crewScheduleDay: [...many("co-busy", 9), ...many("co-mid", 1)],
    dailyFieldReport: [...many("co-busy", 5)],
    jobMedia: [...many("co-busy", 7), ...many("co-mid", 1)],
    quickBooksConnection: [...many("co-busy", 1)],
  };
  return { tables, cookieJar: { value: undefined as string | undefined }, companyCalls: [] as Row[] };
});

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: new Proxy(
    {},
    {
      get(_target, model: string) {
        return new Proxy(
          {},
          {
            get(_t, method: string) {
              return async (args: { where?: Row; select?: Record<string, boolean> } = {}) => {
                const rows = tables[model];
                if (!rows) throw new Error(`no fake table for ${model}`);
                const found = rows.filter((row) => matches(row, args.where));
                if (method === "count") return found.length;
                if (method === "findUnique" || method === "findFirst") {
                  if (model === "company") companyCalls.push(args.where ?? {});
                  return found[0] ?? null;
                }
                throw new Error(`${model}.${method} is not faked`);
              };
            },
          },
        );
      },
    },
  ),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "prova_getting_started_hidden" && cookieJar.value !== undefined ? { value: cookieJar.value } : undefined,
  }),
  headers: async () => new Headers(),
}));

const { runTool, GETTING_STARTED_COMMANDS } = await import("./handlers");
const { gettingStartedChecklist } = await import("@/lib/getting-started");
const { loadGettingStartedCounts } = await import("@/lib/getting-started-counts");

const OWNER: Principal = { role: "OWNER", jobFunction: null };
const FIELD: Principal = { role: "MEMBER", jobFunction: "FIELD" };
const ACCOUNTING: Principal = { role: "MEMBER", jobFunction: "ACCOUNTING" };
const ESTIMATOR: Principal = { role: "MEMBER", jobFunction: "ESTIMATOR" };
const PLAIN_MEMBER: Principal = { role: "MEMBER", jobFunction: null };

type Step = {
  step: string;
  done: boolean;
  optional: boolean;
  whatItMeans: string;
  page: string;
  pageLinkLabel: string;
  askCanDo: { command: string; needsFromPerson: string } | null;
};
type Data = { steps: Step[]; allRequiredDone: boolean; hiddenOnDashboard: boolean | null };

async function ask(companyId: string, principal: Principal) {
  const result = await runTool({ companyId, principal, userId: "u-1" }, "getting_started", {});
  return { result, data: result.data as Data };
}

beforeEach(() => {
  cookieJar.value = undefined;
  companyCalls.length = 0;
});

describe("getting_started: whose checklist", () => {
  it("reads only the asker's company — a new account is not ticked by its busy neighbour", async () => {
    const { data, result } = await ask("co-new", OWNER);
    expect(data.steps.every((step) => !step.done)).toBe(true);
    expect(result.summary).toMatchObject({ requiredSteps: 5, requiredDone: 0, requiredLeft: 5 });
    expect(companyCalls).toEqual([{ id: "co-new" }]);
  });

  it("and the neighbour, asked about itself, is all done", async () => {
    const { data, result } = await ask("co-busy", OWNER);
    expect(data.allRequiredDone).toBe(true);
    expect(result.summary).toMatchObject({ requiredSteps: 5, requiredDone: 5, requiredLeft: 0 });
    // Only the optional import is still open, so it is the only offer.
    expect(data.steps.filter((step) => step.askCanDo).map((step) => step.askCanDo!.command)).toEqual(["add_contact"]);
    // Import is optional and never done — the card says so too.
    expect(data.steps.filter((step) => !step.done).map((step) => step.step)).toEqual([
      "Bring in what you already have",
    ]);
  });

  it("refuses without a person rather than answering with the owner's list", async () => {
    const noActor = await (await import("./handlers")).HANDLERS.getting_started("co-new", {});
    expect(noActor.unavailable).toMatch(/could not be read for this person/);
    expect(noActor.data).toBeNull();
  });
});

describe("getting_started: the same steps as the card", () => {
  for (const [label, principal] of [
    ["owner", OWNER],
    ["field", FIELD],
    ["accounting", ACCOUNTING],
    ["estimator", ESTIMATOR],
    ["member with no job function", PLAIN_MEMBER],
  ] as const) {
    for (const companyId of ["co-new", "co-mid", "co-busy"]) {
      it(`${label} on ${companyId}: same steps, same order, same done, same words and links`, async () => {
        const card = gettingStartedChecklist({
          companyName: tables.company.find((c) => c.id === companyId)!.name as string,
          counts: await loadGettingStartedCounts(companyId),
          viewer: principal,
        });
        const { data, result } = await ask(companyId, principal);
        expect(
          data.steps.map((s) => [s.step, s.done, s.optional, s.page, s.pageLinkLabel]),
        ).toEqual(card.steps.map((s) => [s.title, s.done, s.optional, s.href, s.linkLabel]));
        expect(data.steps.map((s) => s.whatItMeans)).toEqual(
          card.steps.map((s) => (s.done && s.doneBody ? s.doneBody : s.body)),
        );
        expect(data.allRequiredDone).toBe(card.complete);
        expect(result.summary).toMatchObject({ requiredSteps: card.requiredTotal, requiredDone: card.requiredDone });
        // Every step's page is cited, and nothing the card would not show.
        expect(result.citations.map((c) => c.href).sort()).toEqual(
          [...new Set(["/dashboard", ...card.steps.map((s) => s.href)])].sort(),
        );
      });
    }
  }

  it("a half-set-up company reads as the card reads it — written out by hand", async () => {
    const { data } = await ask("co-mid", OWNER);
    expect(Object.fromEntries(data.steps.map((s) => [s.step, s.done]))).toEqual({
      "Put your company's name on it": true,
      "Add your first job": true,
      "Bring in what you already have": false,
      // One user and one ARCHIVED crew record: not done.
      "Add your crew": false,
      "Put someone on the schedule": true,
      // A photo on a job counts on its own.
      "Log your first day on site": true,
      "Connect QuickBooks": false,
    });
  });

  it("a FIELD member gets no owner step — the card leaves them off, and so does this", async () => {
    const { data } = await ask("co-new", FIELD);
    const pages = data.steps.map((s) => s.page);
    expect(pages).not.toContain("/settings");
    expect(pages).not.toContain("/team");
    expect(pages).not.toContain("/settings/integrations");
    expect(pages).toContain("/jobs/new");
  });
});

describe("getting_started: what Ask can do, and what stays a link", () => {
  it("a brand-new owner is offered the job card, and nothing for the name, the crew or QuickBooks", async () => {
    const { data } = await ask("co-new", OWNER);
    const offered = Object.fromEntries(data.steps.map((s) => [s.step, s.askCanDo?.command ?? null]));
    expect(offered).toEqual({
      "Put your company's name on it": null,
      "Add your first job": "create_estimate_job",
      "Bring in what you already have": "add_contact",
      "Add your crew": null,
      "Put someone on the schedule": "schedule_crew",
      "Log your first day on site": "log_daily_field_report",
      "Connect QuickBooks": null,
    });
    expect(data.steps.find((s) => s.step === "Add your first job")!.askCanDo!.needsFromPerson).toMatch(
      /job's name and the general contractor/,
    );
  });

  it("offers no command the asker could not run", async () => {
    const { can } = await import("@/lib/permissions");
    const { commandNamed, canRunCommand } = await import("./commands");
    for (const principal of [OWNER, FIELD, ACCOUNTING, ESTIMATOR, PLAIN_MEMBER]) {
      const { data } = await ask("co-new", principal);
      for (const step of data.steps) {
        if (!step.askCanDo) continue;
        const command = commandNamed(step.askCanDo.command as never);
        expect(canRunCommand(principal, command), `${principal.jobFunction} offered ${command.name}`).toBe(true);
      }
      // And ACCOUNTING, who cannot schedule, is not offered the schedule card.
      if (principal === ACCOUNTING) {
        expect(can(principal, "MANAGE_FIELD")).toBe(false);
        expect(data.steps.some((s) => s.askCanDo?.command === "schedule_crew")).toBe(false);
      }
    }
  });

  it("names only real commands, gated on exactly what each command requires", async () => {
    const { commandNamed } = await import("./commands");
    const entries = Object.entries(GETTING_STARTED_COMMANDS);
    expect(entries.length).toBe(4);
    for (const [, helper] of entries) {
      const command = commandNamed(helper!.command as never);
      expect([...helper!.capabilities].sort()).toEqual(
        [command.capability, ...(command.requiresAlso ?? [])].sort(),
      );
    }
  });

  it("never offers a command for the steps the registry excludes on purpose", async () => {
    const { EXCLUSIONS } = await import("./commands");
    const excluded = EXCLUSIONS.map((e) => e.action);
    // Renaming the company and inviting people are deliberate exclusions.
    expect(excluded).toEqual(expect.arrayContaining(["updateCompanyProfile", "inviteTeamMember"]));
    expect(GETTING_STARTED_COMMANDS["name-company"]).toBeUndefined();
    expect(GETTING_STARTED_COMMANDS.crew).toBeUndefined();
    expect(GETTING_STARTED_COMMANDS.quickbooks).toBeUndefined();
  });
});

describe("getting_started: the hide cookie is information, never a filter", () => {
  it("reports the card hidden for this company, and still returns every step", async () => {
    cookieJar.value = "co-new";
    const { data } = await ask("co-new", OWNER);
    expect(data.hiddenOnDashboard).toBe(true);
    expect(data.steps).toHaveLength(7);
  });

  it("a cookie naming another company does not count", async () => {
    cookieJar.value = "co-busy";
    expect((await ask("co-new", OWNER)).data.hiddenOnDashboard).toBe(false);
  });

  it("no cookie: not hidden", async () => {
    expect((await ask("co-new", OWNER)).data.hiddenOnDashboard).toBe(false);
  });
});
