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
      "add_punch_items",
      "log_time_entry",
      "send_email",
      "reschedule_job",
      "schedule_crew",
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
      "add_bid_pursuit",
      "set_pursuit_stage",
      "add_contact",
      "find_bid_leads",
    ]);
    expect(commandsFor(ESTIMATOR).map((c) => c.name)).not.toContain("add_punch_items");
    // Writing the crew schedule is MANAGE_FIELD, which an estimator lacks.
    expect(commandsFor(ESTIMATOR).map((c) => c.name)).not.toContain("schedule_crew");
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

  it("offers accounting exactly the three money commands, and nothing that touches the field or writes to a GC", () => {
    expect(commandsFor(ACCOUNTING).map((c) => c.name)).toEqual(["draft_invoice", "log_payment", "release_retainage"]);
    for (const command of commandsFor(ACCOUNTING)) {
      expect(command.capability, command.name).toBe("MANAGE_BILLING");
      expect(command.tier, command.name).toBe("T3_MONEY_EVIDENCE");
    }
  });

  it("registers the retainage release as T3, DIRECT over its lifted core, on the capability the job page's Retainage section demands — and withholds it from the field and from estimating", () => {
    // Phase 4d: the last per-action money exclusion in commands/billing.ts,
    // registered from its own file. `showsBilling` on jobs/[id]/page.tsx is
    // `can(principal, "MANAGE_BILLING")`, and that is the whole gate.
    const release = COMMANDS.find((c) => c.name === "release_retainage")!;
    expect(release.tier).toBe("T3_MONEY_EVIDENCE");
    expect(release.mode).toBe("DIRECT");
    expect(release.core).toBe("createRetainageReleaseRecord");
    expect(release.action).toBe("createRetainageRelease");
    expect(release.capability).toBe("MANAGE_BILLING");
    expect(release.requiresAlso).toBeUndefined();
    expect(commandsFor(FIELD).map((c) => c.name)).not.toContain("release_retainage");
    expect(commandsFor(ESTIMATOR).map((c) => c.name)).not.toContain("release_retainage");
    expect(commandsFor({ role: "MEMBER", jobFunction: "PROJECT_MANAGER" }).map((c) => c.name)).toContain("release_retainage");
    // And the delete beside it stays excluded: T5, never a command.
    expect(EXCLUSIONS.map((e) => e.action)).toContain("deleteRetainageRelease");
    expect(EXCLUSIONS.map((e) => e.action)).not.toContain("createRetainageRelease");
  });

  it("registers the pursuit, crew-schedule and contact writes DIRECT over the ActionResult actions their pages call, on the capability those actions check", () => {
    const pinned: Record<string, { action: string; capability: string; tier: string }> = {
      add_bid_pursuit: { action: "createBidPursuit", capability: ROUTE_CAPABILITY["/pipeline"]!, tier: "T1_DRAFT" },
      set_pursuit_stage: { action: "setBidPursuitStage", capability: ROUTE_CAPABILITY["/pipeline"]!, tier: "T2_MODIFY" },
      // lib/actions/crewSchedule.ts: "WRITING it is MANAGE_FIELD".
      schedule_crew: { action: "scheduleCrewDay", capability: "MANAGE_FIELD", tier: "T1_DRAFT" },
      // Stricter than the open /contacts page, deliberately — see
      // commands/contacts.ts. The page itself is unchanged.
      add_contact: { action: "createContact", capability: "MANAGE_ESTIMATING", tier: "T1_DRAFT" },
      // Lead search lands on the same action as add_bid_pursuit, on purpose:
      // the tap writes BidPursuit rows and nothing else (commands/leads.ts).
      find_bid_leads: { action: "createBidPursuit", capability: ROUTE_CAPABILITY["/pipeline"]!, tier: "T1_DRAFT" },
    };
    for (const [name, want] of Object.entries(pinned)) {
      const command = COMMANDS.find((c) => c.name === name)!;
      expect(command.mode, name).toBe("DIRECT");
      expect(command.action, name).toBe(want.action);
      expect(command.core, name).toBe(want.action);
      expect(command.capability, name).toBe(want.capability);
      expect(command.tier, name).toBe(want.tier);
      expect(EXCLUSIONS.map((e) => e.action), name).not.toContain(want.action);
    }
    // The ones beside them that stay on their pages.
    for (const action of ["unscheduleCrewDay", "deleteBidPursuit", "linkBidPursuitToInvitation", "deleteContact", "createLienDeadline"]) {
      expect(EXCLUSIONS.map((e) => e.action), action).toContain(action);
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
      "set_pursuit_stage",
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

  // The behaviour half of team_roster's gate, 2026-09-19. The census below
  // says what it DECLARES; this says who actually stops being offered it,
  // which is the part that was traded away and the part worth a test.
  //
  // It answered for everyone until #310's citation guard showed it
  // summarising /certifications, a MANAGE_FIELD page. Gating it costs the
  // two functions that hold no MANAGE_FIELD.
  it("offers team_roster to the field, and no longer to estimating or accounting", () => {
    expect(toolsFor(FIELD).map((t) => t.name)).toContain("team_roster");
    expect(toolsFor(OWNER).map((t) => t.name)).toContain("team_roster");
    expect(toolsFor(ESTIMATOR).map((t) => t.name)).not.toContain("team_roster");
    expect(toolsFor(ACCOUNTING).map((t) => t.name)).not.toContain("team_roster");

    // A member with no job function set keeps everything — rule 2 in
    // lib/permissions.ts, "nobody loses anything by this feature shipping".
    // Gating a tool must not quietly become the exception to that.
    expect(toolsFor({ role: "MEMBER", jobFunction: null }).map((t) => t.name)).toContain(
      "team_roster",
    );
  });
});

describe("read-tool capabilities match the pages they cite", () => {
  // The rule tools.ts states: a tool answers what its citation page shows.
  const expected: Record<string, string | null> = {
    crew_assignments: null, // /schedule is open
    // Same page, same gate. Reading who is planned where is open; WRITING the
    // schedule is MANAGE_FIELD in lib/actions/crewSchedule.ts, which is the
    // right way round — a tool stricter than the screen beside it refuses
    // what the person can already read.
    crew_schedule: null,
    open_punch_list: ROUTE_CAPABILITY["/punch-lists"],
    compliance_status: ROUTE_CAPABILITY["/compliance"],
    drawing_currency: ROUTE_CAPABILITY["/drawings"],
    job_margin: "VIEW_JOB_COSTS",
    bid_status: ROUTE_CAPABILITY["/bids"],
    // The chase list is shown and edited on /pipeline, so it takes that
    // page's gate — which is MANAGE_ESTIMATING, the same as /bids.
    bid_pursuits: ROUTE_CAPABILITY["/pipeline"],
    open_rfis: ROUTE_CAPABILITY["/rfis"],
    material_deliveries: ROUTE_CAPABILITY["/material-orders"],
    equipment_location: ROUTE_CAPABILITY["/equipment"],
    receivables: "MANAGE_BILLING",
    // Roadmap item 4. Each one is the capability of the page whose figures
    // it reproduces, not the capability that sounds right for the subject.
    cash_flow_forecast: ROUTE_CAPABILITY["/cash-flow"],
    // The retainage receivable table lives on /cash-flow, which is
    // VIEW_COMPANY_FINANCIALS — but this tool is MANAGE_BILLING, and that
    // is a deliberate disagreement rather than an oversight. Retainage is
    // named in MANAGE_BILLING's own doc comment, a PROJECT_MANAGER holds
    // billing and not company financials, and withheld-and-not-yet-released
    // is a per-job billing fact before it is a company-wide one. Erring
    // toward the narrower reading would leave the PM who chases it unable
    // to ask.
    retainage_held: "MANAGE_BILLING",
    // Change orders render inside the job page's `showsJobMoney` branch.
    change_order_status: "VIEW_JOB_COSTS",
    job_labor_cost: "VIEW_JOB_COSTS",
    safety_record: ROUTE_CAPABILITY["/safety"],
    open_submittals: ROUTE_CAPABILITY["/submittals"],
    // /certifications is MANAGE_FIELD, and that is the right gate rather
    // than a compliance one: the question this answers is "who can start on
    // Monday", which a foreman asks and a compliance manager does not.
    certification_expiry: ROUTE_CAPABILITY["/certifications"],
    apprentice_ratio: ROUTE_CAPABILITY["/union-compliance"],
    closeout_status: ROUTE_CAPABILITY["/closeout"],
    fringe_remittance: ROUTE_CAPABILITY["/union-compliance"],
    // /backcharges is MANAGE_BILLING. A backcharge is money the GC is
    // taking off the next cheque, so it sits with whoever chases the
    // cheque rather than with compliance.
    backcharge_exposure: ROUTE_CAPABILITY["/backcharges"],
    // /lien-deadlines is MANAGE_BILLING for the same reason: a lien is how
    // the cheque gets collected when the GC stops sending it.
    lien_deadlines: ROUTE_CAPABILITY["/lien-deadlines"],
    // Apprenticeship standing renders on /union-compliance, which is where
    // its loader is called from — not /certifications, which is cards.
    apprenticeship_standing: ROUTE_CAPABILITY["/union-compliance"],
    daily_field_reports: ROUTE_CAPABILITY["/field-reports"],
    wage_determinations: ROUTE_CAPABILITY["/prevailing-wage"],
    job_photos: ROUTE_CAPABILITY["/photos"],
    vendor_pricing: ROUTE_CAPABILITY["/vendors/pricing"],
    // /contacts is on lib/permissions.test.ts's open list, so this is null
    // by the same rule every other row here follows: a tool takes the gate
    // of the page it cites. A tool stricter than its own screen refuses
    // what the person can already read.
    gc_relationship: null,
    // Same literal as `receivables`: the pay applications section renders
    // inside the job page's money branch, which is not its own route.
    pay_application_status: "MANAGE_BILLING",
    warranty_obligations: ROUTE_CAPABILITY["/closeout"],
    // /messages is on the open list too — the delivery log is open and
    // sending is the action's problem, not the page's.
    outbound_messages: null,

    /* ───────── the eight the assistant could not see ───────── */

    // The certified-payroll page calls requireCapability("MANAGE_COMPLIANCE")
    // directly — it is a dynamic route under /jobs/[id], so it is guarded at
    // the page rather than in ROUTE_CAPABILITY, and that literal is read off
    // the page itself rather than guessed from the subject.
    certified_payroll: "MANAGE_COMPLIANCE",
    // NO PAGE EXISTS FOR T&M TICKETS AT ALL, so this row cannot take a gate
    // from the page it cites and is the one place the rule above has nothing
    // to read. MANAGE_FIELD is the argued answer: a T&M ticket is field
    // paperwork — the foreman describes the extra work and gets it signed on
    // site, and the phone app that writes them is the field app. When the
    // page is built it must be guarded to match, and this line is the thing
    // that will disagree loudly if it is not.
    tm_tickets: "MANAGE_FIELD",
    // Same literal as change_order_status, for the same reason: change
    // orders render inside the job page's `showsJobMoney` branch.
    unbilled_change_orders: "VIEW_JOB_COSTS",
    // /schedule is open, and lib/permissions.test.ts gives the reason this
    // tool is shaped by — "No money on it". The first draft of this tool
    // carried cost percent complete and would have put money on an open
    // surface; the figure was removed rather than the gate tightened,
    // because tightening it locks a foreman out of a question about his own
    // dates.
    schedule_status: null,
    // Line items with prices on them. The job page renders them inside the
    // money branch, same as change orders.
    estimate_detail: "VIEW_JOB_COSTS",
    document_intake: ROUTE_CAPABILITY["/intake"],
    // MANAGE_FIELD, matching /certifications — the tool's answer is mostly
    // that page (certifications on file and what is missing on them), not
    // the open /team roster it was first reasoned from. tools.test.ts
    // carried this as "the one worth fixing" while it was null; fixed
    // 2026-09-19, and ESTIMATOR/ACCOUNTING no longer get a certification
    // summary their own page would refuse.
    team_roster: "MANAGE_FIELD",
    // Dispatch slips are union paperwork and render on /union-compliance.
    dispatch_slips: ROUTE_CAPABILITY["/union-compliance"],
    // The EMR is recorded and shown on /compliance, beside the certificates
    // it is asked for alongside. NOT /safety's MANAGE_FIELD: the OSHA log is
    // what a bureau calculates an EMR from, and the rate is not on that page.
    experience_mod_rate: ROUTE_CAPABILITY["/compliance"],
    // /alerts is open and its CONTENT is filtered per person in
    // lib/alerts-query.ts; the tool calls that loader with the asker's
    // principal, so it is open for the same reason.
    needs_attention: null,
    // /contacts is open; the People section of /contacts/[id] is
    // MANAGE_ESTIMATING and the handler withholds it on that check.
    contact_lookup: null,
    // /jobs/[id] is open with its sections withheld in-page; the handler
    // gates each section on the capability of its own tool.
    job_overview: null,
    // /dashboard is open; the checklist's steps are filtered per person by
    // lib/getting-started.ts, the card's own function.
    getting_started: null,
    // No one page: WHICH walkthroughs this tool may name is filtered per
    // person inside the handler (reachableWalkthroughs), against each
    // matched page's own ROUTE_CAPABILITY — the same rule this file states
    // for every other row, applied per result instead of once for the tool.
    app_help: null,
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
