import { describe, expect, it } from "vitest";
import { CAPABILITIES, ROUTE_CAPABILITY, type Principal } from "@/lib/permissions";
import {
  COMMANDS,
  EXCLUSIONS,
  canRunCommand,
  commandsFor,
  schemaInput,
  toToolDefinition,
} from "./commands";
import { TOOLS, toolsAcceptNoTenantInput, toolsFor } from "./tools";

/**
 * The invariants a command must satisfy to exist. Pinned here so that the
 * next registration — in either lane — cannot quietly drop one: the test
 * iterates the registry, so a new entry is covered the moment it is added.
 */
const OWNER: Principal = { role: "OWNER", jobFunction: null };
const FIELD: Principal = { role: "MEMBER", jobFunction: "FIELD" };
const ESTIMATOR: Principal = { role: "MEMBER", jobFunction: "ESTIMATOR" };
const ACCOUNTING: Principal = { role: "MEMBER", jobFunction: "ACCOUNTING" };

/**
 * A HANDOFF page with no ROUTE_CAPABILITY entry, each with the reason it
 * is open. The invariant below is that nobody offered a command can land
 * on NoAccess when they tap it; a guarded page satisfies that only when
 * its guard IS the command's capability, and an open page satisfies it
 * for everyone. Listed by hand so an unguarded page is a decision here
 * rather than an omission in lib/permissions.ts.
 */
const OPEN_HANDOFF_PAGES: Record<string, string> = {
  "/messages":
    "On lib/permissions.test.ts's open list: the delivery log is open to every signed-in person, and sending is the action's problem, not the page's. send_email's MANAGE_JOBS narrows who is OFFERED the card, not who can reach the composer.",
};

describe("every command", () => {
  it("has a unique name that is not also a read tool's", () => {
    const names = COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    const toolNames = new Set<string>(TOOLS.map((tool) => tool.name));
    for (const name of names) expect(toolNames.has(name), name).toBe(false);
  });

  it("declares a real capability, and any extra ones are real too", () => {
    for (const command of COMMANDS) {
      expect(CAPABILITIES, command.name).toContain(command.capability);
      for (const extra of command.requiresAlso ?? []) {
        expect(CAPABILITIES, `${command.name} requiresAlso`).toContain(extra);
      }
    }
  });

  it("takes no tenant, user or actor field from the model, in the same test the read tools pass", () => {
    expect(toolsAcceptNoTenantInput([...TOOLS, ...COMMANDS])).toBe(true);
  });

  it("requires nothing in its schema — a missing field is a question, never a schema error", () => {
    for (const command of COMMANDS) {
      expect(toToolDefinition(command).input_schema.required, command.name).toEqual([]);
    }
  });

  it("is DIRECT only through a lifted core", () => {
    for (const command of COMMANDS) {
      if (command.mode === "DIRECT") {
        expect(command.core, `${command.name} is DIRECT with no core`).toBeTruthy();
      }
    }
  });

  it("pairs its mode with its mechanism: DIRECT executes, HANDOFF links, never both", () => {
    for (const command of COMMANDS) {
      if (command.mode === "DIRECT") {
        expect(typeof command.execute, `${command.name} is DIRECT with no execute`).toBe("function");
        expect(command.handoffHref, `${command.name} is DIRECT with a page`).toBeUndefined();
      } else {
        expect(command.execute, `${command.name} is HANDOFF with an execute`).toBeUndefined();
        expect(command.core, `${command.name} is HANDOFF with a core`).toBeUndefined();
        expect(typeof command.handoffHref, `${command.name} is HANDOFF with no page`).toBe("function");
        // The page it opens is the one guarded by the command's own
        // capability — or open to everyone, with the reason recorded above
        // — and the card id rides in ?draft= and nowhere else.
        const href = command.handoffHref!("card-id");
        const [path, query] = href.split("?");
        expect(query, command.name).toBe("draft=card-id");
        if (path in OPEN_HANDOFF_PAGES) {
          expect(ROUTE_CAPABILITY[path], `${path} is listed open but is guarded`).toBeUndefined();
        } else {
          expect(ROUTE_CAPABILITY[path], `${command.name} opens ${path}`).toBe(command.capability);
        }
      }
    }
  });

  it("describes what it does NOT do, like every read tool", () => {
    for (const command of COMMANDS) {
      expect(command.description.length, command.name).toBeGreaterThan(80);
      expect(command.description, command.name).toMatch(/does not/i);
    }
  });

  it("has a title, a verb and a button written for a person, not a function name", () => {
    for (const command of COMMANDS) {
      for (const text of [command.title, command.verb, command.button]) {
        expect(text, command.name).not.toContain("_");
        expect(text.length, command.name).toBeGreaterThan(3);
      }
    }
  });

  it("gives every schema property a type and a real description", () => {
    for (const command of COMMANDS) {
      for (const [key, prop] of Object.entries(command.input_schema.properties)) {
        expect(prop.type, `${command.name}.${key}`).toBe("string");
        expect(prop.description.length, `${command.name}.${key}`).toBeGreaterThan(10);
      }
    }
  });

  it("never lets a continuation key double as a model-facing property", () => {
    for (const command of COMMANDS) {
      for (const key of command.continuationKeys ?? []) {
        expect(command.input_schema.properties, `${command.name}.${key}`).not.toHaveProperty(key);
      }
    }
  });
});

describe("who is offered what", () => {
  it("offers an owner everything, and a FIELD member the field, RFI and email commands and nothing that prices", () => {
    expect(commandsFor(OWNER).length).toBe(COMMANDS.length);
    const field = commandsFor(FIELD).map((c) => c.name);
    expect(field).toEqual([
      "log_daily_field_report",
      "record_material_delivery",
      "send_equipment_to_job",
      "bring_equipment_back",
      "raise_rfi",
      "add_punch_item",
      "log_time_entry",
      "send_email",
      "reschedule_job",
    ]);
    // FIELD holds MANAGE_FIELD and MANAGE_JOBS (lib/permissions.ts: "an
    // RFI when the drawings are wrong"), and nothing else — so no money.
    for (const command of commandsFor(FIELD)) {
      expect(["MANAGE_FIELD", "MANAGE_JOBS"], command.name).toContain(command.capability);
    }
  });

  it("offers an estimator the estimating commands, the RFI, the email, the schedule change and the bid invitation — MANAGE_JOBS held, MANAGE_FIELD not", () => {
    expect(commandsFor(ESTIMATOR).map((c) => c.name)).toEqual([
      "create_estimate_job",
      "draft_estimate_lines",
      "add_catalog_line",
      "raise_rfi",
      "send_email",
      "reschedule_job",
      "log_bid_invitation",
    ]);
    expect(commandsFor(ESTIMATOR).map((c) => c.name)).not.toContain("add_punch_item");
  });

  it("registers the bid invitation as a T1 draft, DIRECT over its lifted core, on the capability that guards /bids — and withholds it from the field and from accounting", () => {
    const bid = COMMANDS.find((c) => c.name === "log_bid_invitation")!;
    expect(bid.tier).toBe("T1_DRAFT");
    expect(bid.mode).toBe("DIRECT");
    expect(bid.core).toBe("createBidInvitationRecord");
    expect(bid.action).toBe("createBidInvitation");
    expect(bid.capability).toBe(ROUTE_CAPABILITY["/bids"]);
    expect(bid.capability).toBe("MANAGE_ESTIMATING");
    // No money on the card, so nothing beyond the page's own guard.
    expect(bid.requiresAlso).toBeUndefined();
    expect(commandsFor(FIELD).map((c) => c.name)).not.toContain("log_bid_invitation");
    expect(commandsFor(ACCOUNTING).map((c) => c.name)).not.toContain("log_bid_invitation");
    expect(commandsFor({ role: "MEMBER", jobFunction: "PROJECT_MANAGER" }).map((c) => c.name)).toContain("log_bid_invitation");
  });

  it("offers accounting exactly the two money commands, and nothing that touches the field or writes to a GC", () => {
    expect(commandsFor(ACCOUNTING).map((c) => c.name)).toEqual(["draft_invoice", "log_payment"]);
    for (const command of commandsFor(ACCOUNTING)) {
      expect(command.capability, command.name).toBe("MANAGE_BILLING");
      expect(command.tier, command.name).toBe("T3_MONEY_EVIDENCE");
    }
  });

  it("registers the outward send as T4 and HANDOFF only — a tap never sends", () => {
    const outward = COMMANDS.filter((c) => c.tier === "T4_OUTWARD");
    expect(outward.map((c) => c.name)).toEqual(["send_email"]);
    for (const command of outward) {
      expect(command.mode, command.name).toBe("HANDOFF");
      expect(command.execute, command.name).toBeUndefined();
    }
  });

  it("registers the schedule change as a T2 modify beside the three that stamp today — DIRECT over a lifted core, on the capability whose doc comment says 'jobs themselves'", () => {
    // The whole tier, pinned: the phase-2a three stamp today on a stay or
    // close an order; reschedule_job is the first to rewrite a row to
    // values the person stated, which is why it alone carries the dates
    // the card was made from and compares before it sets.
    const modifies = COMMANDS.filter((c) => c.tier === "T2_MODIFY");
    expect(modifies.map((c) => c.name)).toEqual([
      "record_material_delivery",
      "send_equipment_to_job",
      "bring_equipment_back",
      "reschedule_job",
    ]);
    const reschedule = COMMANDS.find((c) => c.name === "reschedule_job")!;
    expect(reschedule.mode).toBe("DIRECT");
    expect(reschedule.core).toBe("setJobScheduleDates");
    expect(reschedule.capability).toBe("MANAGE_JOBS");
    // Not offered to the two functions that hold no MANAGE_JOBS, who can
    // still edit the dates by hand on the open job page.
    expect(commandsFor(ACCOUNTING).map((c) => c.name)).not.toContain("reschedule_job");
    expect(commandsFor({ role: "MEMBER", jobFunction: "PAYROLL_COMPLIANCE" }).map((c) => c.name)).not.toContain("reschedule_job");
  });

  it("withholds create_estimate_job from accounting, who could not open the estimate it made", () => {
    const create = COMMANDS.find((c) => c.name === "create_estimate_job")!;
    expect(canRunCommand(ACCOUNTING, create)).toBe(false);
  });

  it("filters read tools by the capability their page needs", () => {
    const field = toolsFor(FIELD).map((tool) => tool.name);
    expect(field).not.toContain("job_margin");
    expect(field).not.toContain("receivables");
    expect(field).toContain("open_punch_list");
    expect(field).toContain("crew_assignments");
    expect(toolsFor(OWNER).length).toBe(TOOLS.length);
  });
});

describe("read-tool capabilities match the pages they cite", () => {
  // The rule tools.ts states: a tool answers what its citation page shows.
  const expected: Record<string, string | null> = {
    crew_assignments: null, // /schedule is open
    open_punch_list: ROUTE_CAPABILITY["/punch-lists"],
    compliance_status: ROUTE_CAPABILITY["/compliance"],
    drawing_currency: ROUTE_CAPABILITY["/drawings"],
    job_margin: "VIEW_JOB_COSTS",
    bid_status: ROUTE_CAPABILITY["/bids"],
    open_rfis: ROUTE_CAPABILITY["/rfis"],
    material_deliveries: ROUTE_CAPABILITY["/material-orders"],
    equipment_location: ROUTE_CAPABILITY["/equipment"],
    receivables: "MANAGE_BILLING",
  };

  it.each(TOOLS.map((tool) => [tool.name, tool.capability] as const))("%s", (name, capability) => {
    expect(expected, `${name} has no expectation`).toHaveProperty(name);
    expect(capability).toBe(expected[name]);
  });
});

describe("schemaInput", () => {
  const command = COMMANDS.find((c) => c.name === "create_estimate_job")!;

  it("keeps schema keys as trimmed strings and drops everything else from the model", () => {
    const input = schemaInput(
      command,
      { jobName: "  Riverside Plaza ", gcName: "Turner", contactId: "forged", companyId: "x", nested: { a: 1 } },
      "model",
    );
    expect(input).toEqual({ jobName: "Riverside Plaza", gcName: "Turner" });
  });

  it("lets a chip add a continuation key, and only a continuation key", () => {
    const input = schemaInput(command, { jobName: "R", contactId: "c1", companyId: "x" }, "continuation");
    expect(input).toEqual({ jobName: "R", contactId: "c1" });
  });

  it("caps a value the model supplies at the question limit", () => {
    const input = schemaInput(command, { scope: "x".repeat(2000) }, "model");
    expect(input.scope?.length).toBe(1000);
  });

  it("turns a number into its string rather than dropping it", () => {
    const line = COMMANDS.find((c) => c.name === "add_catalog_line")!;
    expect(schemaInput(line, { quantity: 200 }, "model")).toEqual({ quantity: "200" });
  });
});

describe("exclusions", () => {
  it("each carry a reason a person could act on", () => {
    for (const exclusion of EXCLUSIONS) {
      expect(exclusion.reason.length, exclusion.action).toBeGreaterThanOrEqual(30);
    }
  });

  it("never exclude something that is also registered", () => {
    const registered = new Set(COMMANDS.map((c) => c.action));
    for (const exclusion of EXCLUSIONS) {
      expect(registered.has(exclusion.action), exclusion.action).toBe(false);
    }
  });
});
