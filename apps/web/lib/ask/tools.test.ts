import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROUTE_CAPABILITY } from "@/lib/permissions";
import {
  KNOWN_GAPS,
  TOOLS,
  matchesJobName,
  toolsAcceptNoTenantInput,
  type ToolName,
} from "./tools";

describe("the tenant boundary", () => {
  it("lets no tool take a company or user id from the model", () => {
    // The one mistake here that would be a breach rather than a bug. Job
    // names and RFI text are user-written and reach the prompt, so a model
    // that could be argued into changing whose data it reads would be a
    // data breach with extra steps. companyId comes from the session.
    expect(toolsAcceptNoTenantInput()).toBe(true);
  });

  // Guarding the guard. This used to RE-IMPLEMENT the forbidden list and the
  // loop inline, so it proved that a copy of the check could fail and said
  // nothing about the real one — emptying `forbidden` in tools.ts left the
  // suite green (issue #108). It now calls the real predicate, which is why
  // that predicate takes its tool list as an argument.
  const withInput = (properties: Record<string, { type: string; description: string }>) => [
    {
      name: "crew_assignments" as ToolName,
      description: "x",
      input_schema: { type: "object" as const, properties },
    },
  ];

  it("catches a tenant field if one is ever added", () => {
    expect(
      toolsAcceptNoTenantInput(withInput({ companyId: { type: "string", description: "x" } })),
    ).toBe(false);
  });

  it("catches EVERY spelling of whose-data-is-this, not just companyId", () => {
    // The list in tools.ts is the guard. If an entry is ever dropped, the
    // corresponding case here goes red instead of the breach shipping.
    for (const field of ["companyId", "company", "tenant", "userId", "user", "orgId"]) {
      expect(
        toolsAcceptNoTenantInput(withInput({ [field]: { type: "string", description: "x" } })),
        field,
      ).toBe(false);
    }
  });

  it("is case-insensitive, so COMPANYID does not slip past", () => {
    expect(
      toolsAcceptNoTenantInput(withInput({ COMPANYID: { type: "string", description: "x" } })),
    ).toBe(false);
  });

  it("still passes an honest tool, so it is not just returning false", () => {
    expect(
      toolsAcceptNoTenantInput(withInput({ jobName: { type: "string", description: "x" } })),
    ).toBe(true);
    expect(toolsAcceptNoTenantInput([])).toBe(true);
  });
});

describe("tool definitions", () => {
  it("has a unique name for every tool", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every tool a description that says what it does NOT answer", () => {
    // A tool description that oversells is how a model answers a question
    // with the wrong data. Every tool covering a subject with a known gap
    // beside it has to name the gap.
    const mustDisclaim: ToolName[] = [
      "crew_assignments",
      "job_margin",
      "equipment_location",
      "receivables",
      "open_rfis",
      // Roadmap item 4. Every one of these sits next to a question it
      // must refuse: the bank balance beside the forecast, a GC's
      // agreement beside a retainage balance, a decision date beside a
      // submitted change order, unpriced hours beside a labor total, and
      // who attended beside a toolbox talk.
      "cash_flow_forecast",
      "retainage_held",
      "change_order_status",
      "job_labor_cost",
      "safety_record",
    ];
    for (const name of mustDisclaim) {
      const tool = TOOLS.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.description.toLowerCase(), name).toMatch(/does not|cannot|not a live|it does not/);
    }
  });

  it("declares a valid object schema for every tool", () => {
    for (const tool of TOOLS) {
      expect(tool.input_schema.type, tool.name).toBe("object");
      expect(typeof tool.input_schema.properties, tool.name).toBe("object");
      for (const [key, prop] of Object.entries(tool.input_schema.properties)) {
        expect(prop.type, `${tool.name}.${key}`).toBeTruthy();
        expect(prop.description.length, `${tool.name}.${key}`).toBeGreaterThan(10);
      }
    }
  });

  it("marks no input as required — a question should never fail on a missing filter", () => {
    // Every filter is optional on purpose: "what's on the punch list"
    // should answer across all jobs rather than refuse for want of a job
    // name the person did not say.
    for (const tool of TOOLS) {
      expect(tool.input_schema.required ?? [], tool.name).toEqual([]);
    }
  });

  it("covers the questions this was built for", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "crew_assignments",
        "open_punch_list",
        "compliance_status",
        "drawing_currency",
        "job_margin",
        "bid_status",
        "open_rfis",
        "material_deliveries",
        "equipment_location",
        "receivables",
        "cash_flow_forecast",
        "retainage_held",
        "change_order_status",
        "job_labor_cost",
        "safety_record",
      ]),
    );
  });
});

describe("bid_status / material_deliveries status filter (issue #103, finding 4)", () => {
  // Neither schema marks status required — the "marks no input as
  // required" test above already covers that generically — this pins the
  // specific values a model is allowed to pass, since a truncation fix that
  // silently drops OUTSTANDING would defeat the whole point of finding 4.
  it("offers bid_status an OUTSTANDING status alongside each real one", () => {
    const tool = TOOLS.find((t) => t.name === "bid_status")!;
    expect(tool.input_schema.properties.status?.enum).toEqual(
      expect.arrayContaining(["OUTSTANDING", "INVITED", "SUBMITTED", "WON", "LOST", "DECLINED"]),
    );
  });

  it("offers material_deliveries only OUTSTANDING — there is no stored status to filter to a specific value", () => {
    const tool = TOOLS.find((t) => t.name === "material_deliveries")!;
    expect(tool.input_schema.properties.status?.enum).toEqual(["OUTSTANDING"]);
    // Still takes jobName — the status filter is additive, not a replacement.
    expect(tool.input_schema.properties.jobName).toBeDefined();
  });
});

describe("a tool that a WIDE question would otherwise be answered from alone", () => {
  const jobOverview = TOOLS.find((tool) => tool.name === "job_overview");

  it("says what it does NOT hold, so the wide question reads more than it", () => {
    // The third thing standing in composition's way, and the least obvious:
    // this tool's description claims "how's Riverside looking" for itself,
    // and it holds no receivables. So the exact question this box is asked
    // most — how is this job doing — routed to the one tool that cannot say
    // the GC is 42 days late, and the answer looked complete.
    //
    // A tool that names the question it answers has to name the half it
    // does not, or the model has no reason to read a second one.
    expect(jobOverview?.description).toMatch(/holds no receivables/i);
    expect(jobOverview?.description).toMatch(/read together/i);
    // And the specific trap underneath it: this tool DOES carry
    // billedToDate, which reads like money received and is money invoiced.
    expect(jobOverview?.description).toMatch(/what was invoiced, not what was paid/i);
  });

  it("names the tools that hold the missing half, and they exist", () => {
    // A description that says "read something else" and does not say WHAT
    // is an instruction nobody can follow. Both names are checked against
    // the registry so a rename cannot leave this pointing at nothing.
    const names = TOOLS.map((tool) => tool.name);
    for (const named of ["receivables", "retainage_held"] as const) {
      expect(jobOverview?.description, named).toContain(named);
      expect(names).toContain(named);
    }
  });
});

describe("KNOWN_GAPS", () => {
  it("explains every gap rather than just naming it", () => {
    // "We don't track that" is only a good answer when it says what would
    // be needed. Each gap carries its reason so the model can give one.
    for (const gap of KNOWN_GAPS) {
      expect(gap.topic.length).toBeGreaterThan(5);
      expect(gap.why.length).toBeGreaterThan(30);
    }
  });

  it("names the payroll-cash question specifically", () => {
    // The most-asked question we cannot answer, and the most dangerous to
    // answer approximately.
    const cash = KNOWN_GAPS.find((gap) => gap.topic.includes("payroll"));
    expect(cash).toBeDefined();
    expect(cash!.why).toContain("bank balance");
  });
});

describe("matchesJobName", () => {
  it("matches a fragment, case-insensitively", () => {
    expect(matchesJobName("Riverside Medical — Level 4", "riverside")).toBe(true);
    expect(matchesJobName("Riverside Medical — Level 4", "LEVEL 4")).toBe(true);
  });

  it("matches everything when no filter is given", () => {
    // "What's on the punch list" should answer across all jobs, not refuse.
    expect(matchesJobName("Anything", undefined)).toBe(true);
    expect(matchesJobName("Anything", "")).toBe(true);
    expect(matchesJobName("Anything", "   ")).toBe(true);
  });

  it("does not match an unrelated job", () => {
    expect(matchesJobName("Riverside Medical", "harborview")).toBe(false);
  });

  it("ignores surrounding space in what someone typed", () => {
    expect(matchesJobName("Riverside Medical", "  riverside  ")).toBe(true);
  });
});

describe("the actor boundary", () => {
  it("catches an actor or proposal field the way it catches a tenant field", () => {
    // Added with the command registry: a command that accepted a user id,
    // a role, or a proposal id from the model would let the model choose
    // who is acting or which card it is executing.
    for (const key of ["role", "jobFunction", "actorId", "ownerId", "proposalId"]) {
      expect(
        toolsAcceptNoTenantInput([
          { input_schema: { type: "object", properties: { [key]: { type: "string", description: "x" } } } },
        ]),
        key,
      ).toBe(false);
    }
  });
});

/**
 * WHAT EACH TOOL CITES, AND WHETHER ITS ASKER COULD OPEN IT.
 *
 * THIS BLOCK EXISTS BECAUSE tools.ts SAID IT ALREADY DID. The doc comment
 * on `ToolDefinition.capability` read "tools.test.ts pins each one against
 * ROUTE_CAPABILITY"; this file had nineteen tests and mentioned neither
 * `capability` nor `ROUTE_CAPABILITY`. `commands.test.ts` pins the sixteen
 * COMMANDS that way, which is probably where the sentence came from — it
 * was never true of the read tools. A documented guard that does not exist
 * is worse than none: it is the reason nobody wrote one.
 *
 * WHAT IT CATCHES, and it is the defect the capability field was added for.
 * Until 2026-09-08 the executor knew only the company, so a FIELD-function
 * member the dashboard withholds margin from could ask the box beside those
 * tiles and be answered. `capability` fixed that by filtering the offered
 * list per person. But `capability` is ONE field and a handler cites
 * SEVERAL pages, so the declared capability covers whichever page its
 * author had in mind and nothing checks the others — a gap that grew with
 * the tool list, which went from fifteen to thirty-nine in ten days.
 *
 * THE INVARIANT IS commands.test.ts's, borrowed deliberately: nobody
 * offered a tool should be handed a citation they cannot open. A page with
 * no ROUTE_CAPABILITY entry is open and satisfies that for everyone; a
 * guarded page satisfies it only when its guard IS the tool's capability.
 *
 * The mapping is DERIVED from handlers.ts rather than hand-written, so it
 * cannot drift from the citations actually emitted. Deriving has two
 * failure modes, not one (CLAUDE.md), so the size checks below run first:
 * a parse that silently matched nothing would otherwise pass every
 * assertion after it.
 */
const handlersSource = readFileSync(
  fileURLToPath(new URL("./handlers.ts", import.meta.url)),
  "utf8",
);

/** tool name -> the pages its handler cites. */
function citedPages(): Map<ToolName, string[]> {
  const record = /export const HANDLERS[\s\S]*?\n\};/.exec(handlersSource);
  if (!record) throw new Error("could not find the HANDLERS record in handlers.ts");
  const out = new Map<ToolName, string[]>();
  for (const [, tool, fn] of record[0].matchAll(
    /^ {2}([a-z_]+):\s*(?:\([^)]*\)\s*=>\s*)?([A-Za-z_]+)/gm,
  )) {
    // The handler's own body, up to the next top-level declaration.
    const body = new RegExp(
      `(?:async function|const)\\s+${fn}\\b[\\s\\S]*?(?=\\n(?:async function|const|export)\\s|$)`,
    ).exec(handlersSource);
    const hrefs = body ? [...body[0].matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]) : [];
    // `/jobs/abc` and `/cash-flow?x=1` are both the route they start with.
    const pages = [...new Set(hrefs.map((h) => `/${h.replace(/^\//, "").split(/[/?]/)[0]}`))];
    out.set(tool as ToolName, pages);
  }
  return out;
}

/**
 * Tool/page pairs where the two disagree TODAY, each with why it is here.
 * Listed by hand so a disagreement is a decision somebody wrote down
 * rather than something the guard quietly tolerates — the same shape as
 * commands.test.ts's OPEN_HANDOFF_PAGES. The last test requires every
 * entry to still BE a disagreement, so a fixed one must be deleted rather
 * than left to rot.
 */
const CITATION_CAPABILITY_GAPS: Record<string, string> = {
  "receivables /cash-flow":
    "Declares MANAGE_BILLING; /cash-flow is VIEW_COMPANY_FINANCIALS. The DATA is gated by the declared capability, so this is a citation someone may not be able to open rather than a leak. Reported 2026-09-18.",
  "retainage_held /cash-flow":
    "As receivables above — same tool family, same secondary citation.",
  "unbilled_change_orders /cash-flow":
    "Declares VIEW_JOB_COSTS; /cash-flow is VIEW_COMPANY_FINANCIALS. Its primary citation /jobs is open.",
};

describe("what a tool cites, and whether its asker could open it", () => {
  const cited = citedPages();

  it("parses a handler for every tool, and a citation for every handler", () => {
    // An empty question passes everything below it.
    expect(cited.size).toBe(TOOLS.length);
    const silent = [...cited].filter(([, pages]) => pages.length === 0).map(([tool]) => tool);
    expect(silent, `these handlers yielded no citation, so nothing below checked them: ${silent.join(", ")}`).toEqual([]);
  });

  it("offers no tool whose citation its asker could not open", () => {
    const offenders: string[] = [];
    for (const tool of TOOLS) {
      for (const page of cited.get(tool.name) ?? []) {
        const guard = ROUTE_CAPABILITY[page as keyof typeof ROUTE_CAPABILITY];
        if (guard === undefined || guard === tool.capability) continue;
        if (`${tool.name} ${page}` in CITATION_CAPABILITY_GAPS) continue;
        offenders.push(`${tool.name} declares ${tool.capability} but cites ${page}, guarded by ${guard}`);
      }
    }
    expect(
      offenders,
      `A tool offered to somebody who cannot open the page it cites hands them a dead link — and, where the ` +
        `capability is null, answers a question the page itself would refuse: ${offenders.join("; ")}`,
    ).toEqual([]);
  });

  it("keeps no gap in the list after it has been fixed", () => {
    const stale: string[] = [];
    for (const key of Object.keys(CITATION_CAPABILITY_GAPS)) {
      const [name, page] = key.split(" ");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) { stale.push(`${key} — no such tool`); continue; }
      if (!(cited.get(tool.name) ?? []).includes(page)) { stale.push(`${key} — no longer cited`); continue; }
      const guard = ROUTE_CAPABILITY[page as keyof typeof ROUTE_CAPABILITY];
      if (guard === undefined || guard === tool.capability) stale.push(`${key} — they agree now`);
    }
    expect(
      stale,
      `An exception list nobody prunes becomes permanent. Delete these: ${stale.join("; ")}`,
    ).toEqual([]);
  });
});
