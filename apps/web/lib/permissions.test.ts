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
  it("lets anyone signed in reach an unguarded route", () => {
    expect(canReach(member("FIELD"), "/dashboard")).toBe(true);
    expect(canReach(member("FIELD"), "/safety")).toBe(true);
    expect(canReach(member("FIELD"), "/alerts")).toBe(true);
  });

  it("keeps a foreman off the money routes", () => {
    expect(canReach(member("FIELD"), "/cash-flow")).toBe(false);
    expect(canReach(member("FIELD"), "/backcharges")).toBe(false);
    expect(canReach(member("FIELD"), "/catalog")).toBe(false);
  });

  it("agrees with can() on every guarded route, for every principal", () => {
    // The nav filter and the page guards read the same map. This is what
    // stops a link being shown to a door that will not open, and — far
    // worse — a door being left unlisted but unguarded.
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
