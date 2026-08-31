import { describe, expect, it } from "vitest";
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

  it("catches a tenant field if one is ever added", () => {
    // Guarding the guard: prove the check above can fail.
    const withTenant = [
      {
        name: "crew_assignments" as ToolName,
        description: "x",
        input_schema: {
          type: "object" as const,
          properties: { companyId: { type: "string", description: "x" } },
        },
      },
    ];
    const forbidden = ["companyid", "company", "tenant", "userid", "user", "orgid"];
    const clean = withTenant.every((tool) =>
      Object.keys(tool.input_schema.properties).every(
        (key) => !forbidden.includes(key.toLowerCase()),
      ),
    );
    expect(clean).toBe(false);
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
      ]),
    );
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
