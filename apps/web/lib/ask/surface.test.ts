import { describe, expect, it } from "vitest";
import { JOB_FUNCTIONS, type Principal } from "@/lib/permissions";
import { COMMANDS, commandsFor } from "./commands";
import { EXTRA_TOOLS, linksFor, offeredTools } from "./answer";
import { TOOLS, toolsFor } from "./tools";
import {
  BID_ASK_COMMANDS,
  BID_EXCLUDED_COMMANDS,
  BID_SURFACE_RULE,
  askSurfaceOf,
  commandAllowedOn,
  commandsForSurface,
} from "./surface";

/**
 * THE SURFACE FLAG NARROWS AND NEVER WIDENS — and the Bid list is a decision,
 * not a leftover.
 *
 * The narrowing is proved for EVERY principal the app has (the owner and each
 * job function), not just the owner: a filter that happened to be right for
 * the person holding every capability could still offer a field hand a command
 * on Bid that the CRM would have withheld from them.
 */

const PRINCIPALS: Principal[] = [
  { role: "OWNER", jobFunction: null },
  ...JOB_FUNCTIONS.map((jobFunction) => ({ role: "MEMBER" as const, jobFunction })),
  { role: "MEMBER", jobFunction: null },
];
const OWNER: Principal = { role: "OWNER", jobFunction: null };
const names = (list: { name: string }[]) => list.map((c) => c.name).sort();

describe("askSurfaceOf: one word or nothing", () => {
  it("knows \"bid\"", () => {
    expect(askSurfaceOf("bid")).toBe("bid");
  });
  it("drops everything else to undefined", () => {
    for (const value of [undefined, null, "", "crm", "BID", " bid", "bid ", "admin", 0, 1, true, {}, ["bid"], { surface: "bid" }]) {
      expect(askSurfaceOf(value), JSON.stringify(value)).toBeUndefined();
    }
  });
});

describe("commandsForSurface NARROWS, for every principal", () => {
  it("is a subset of commandsFor(principal) on Bid — never a command the person could not already be offered", () => {
    expect(PRINCIPALS.length).toBeGreaterThanOrEqual(4);
    for (const principal of PRINCIPALS) {
      const crm = new Set(names(commandsFor(principal)));
      for (const name of names(commandsForSurface(principal, "bid"))) {
        expect(crm.has(name), `${JSON.stringify(principal)} offered ${name} on Bid but not in the CRM`).toBe(true);
      }
    }
  });

  it("offers ONLY the Bid allowlist on Bid", () => {
    for (const principal of PRINCIPALS) {
      for (const name of names(commandsForSurface(principal, "bid"))) {
        expect(BID_ASK_COMMANDS as readonly string[], name).toContain(name);
      }
    }
    // The owner holds every capability, so the owner's Bid list IS the
    // allowlist — pinned so the subset check above cannot pass on an empty list.
    expect(names(commandsForSurface(OWNER, "bid"))).toEqual([...BID_ASK_COMMANDS].sort());
    expect(BID_ASK_COMMANDS.length).toBeGreaterThanOrEqual(2);
  });

  it("without a surface is exactly the CRM's list, unchanged", () => {
    for (const principal of PRINCIPALS) {
      expect(names(commandsForSurface(principal, undefined)), JSON.stringify(principal)).toEqual(names(commandsFor(principal)));
    }
  });

  it("is genuinely narrower than the CRM on Bid (it is not the identity)", () => {
    expect(commandsForSurface(OWNER, "bid").length).toBeLessThan(commandsFor(OWNER).length);
  });

  it("commandAllowedOn agrees with the list, both ways", () => {
    for (const command of COMMANDS) {
      expect(commandAllowedOn(undefined, command.name)).toBe(true);
      expect(commandAllowedOn("bid", command.name), command.name).toBe((BID_ASK_COMMANDS as readonly string[]).includes(command.name));
    }
  });
});

describe("the Bid allowlist is a decision about every command", () => {
  it("every registered command is EITHER allowed or excluded with a reason, never both, never neither", () => {
    const allowed = new Set<string>(BID_ASK_COMMANDS);
    const excluded = new Set(Object.keys(BID_EXCLUDED_COMMANDS));
    expect(COMMANDS.length).toBeGreaterThan(10);
    for (const command of COMMANDS) {
      const inAllowed = allowed.has(command.name);
      const inExcluded = excluded.has(command.name);
      expect(inAllowed !== inExcluded, `${command.name}: decide whether the Bid job box offers it (lib/ask/surface.ts)`).toBe(true);
    }
    // And no stale names: every listed name is a registered command.
    const registered = new Set(COMMANDS.map((c) => c.name));
    for (const name of [...allowed, ...excluded]) expect(registered.has(name as never), `${name} is not a command`).toBe(true);
    for (const reason of Object.values(BID_EXCLUDED_COMMANDS)) expect((reason ?? "").length).toBeGreaterThan(20);
  });

  it("every allowed command writes in place: DIRECT, with no handoff link", () => {
    for (const name of BID_ASK_COMMANDS) {
      const command = COMMANDS.find((c) => c.name === name)!;
      expect(command.mode, name).toBe("DIRECT");
      expect(command.handoffHref, name).toBeUndefined();
    }
  });

  it("never offers a HANDOFF command on Bid — every one of them links into the CRM", () => {
    const handoffs = COMMANDS.filter((c) => c.mode === "HANDOFF");
    expect(handoffs.length).toBeGreaterThan(0);
    for (const command of handoffs) expect(commandAllowedOn("bid", command.name), command.name).toBe(false);
  });
});

describe("offeredTools on Bid", () => {
  it("is the read tools, the Bid commands and the extras — no other command reaches the model", () => {
    const offered = offeredTools(OWNER, "bid");
    expect(offered).toHaveLength(TOOLS.length + BID_ASK_COMMANDS.length + EXTRA_TOOLS.length);
    const commandNames = new Set<string>(COMMANDS.map((c) => c.name));
    const offeredCommands = offered.map((t) => t.name).filter((n) => commandNames.has(n)).sort();
    expect(offeredCommands).toEqual([...BID_ASK_COMMANDS].sort());
    // Each still carries only the three API fields (answer.test.ts's census).
    for (const tool of offered) expect(Object.keys(tool).sort()).toEqual(["description", "input_schema", "name"]);
  });

  it("without a surface is unchanged", () => {
    expect(offeredTools(OWNER)).toHaveLength(TOOLS.length + COMMANDS.length + EXTRA_TOOLS.length);
    expect(offeredTools(OWNER, undefined).map((t) => t.name)).toEqual(offeredTools(OWNER).map((t) => t.name));
  });

  it("reads are not narrowed by the surface", () => {
    const reads = new Set(toolsFor(OWNER).map((t) => t.name));
    const offered = new Set(offeredTools(OWNER, "bid").map((t) => t.name));
    for (const name of reads) expect(offered.has(name), name).toBe(true);
  });
});

describe("linksFor: the answer's record buttons", () => {
  const links = [
    { label: "Riverside", href: "/jobs/abc" },
    { label: "Overdue", href: "/invoices?x=1" },
    { label: "The estimate", href: "/bid/estimates/abc/estimate" },
  ];
  it("keeps only /bid paths on Bid", () => {
    expect(linksFor("bid", links).map((l) => l.href)).toEqual(["/bid/estimates/abc/estimate"]);
  });
  it("leaves the CRM's untouched", () => {
    expect(linksFor(undefined, links)).toBe(links);
  });
});

describe("what the model is told on Bid", () => {
  it("says it is in Bid and must not name paths", () => {
    expect(BID_SURFACE_RULE).toContain("C Stream Bid");
    expect(BID_SURFACE_RULE).toMatch(/never write a URL or a path/);
  });
});
