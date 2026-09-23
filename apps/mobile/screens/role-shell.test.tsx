import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { deviceStore, goOffline } from "./setup";
import { mount } from "./render";

/**
 * The phone as a person with a narrower job function sees it.
 *
 * Before this, every screen was shown to everybody: an ACCOUNTING user
 * got the whole foreman app — Create, Camera, punch lists, hours — and
 * found out what they were not allowed to do by tapping and getting a
 * 403, which renders as an empty screen saying nothing at all. The server
 * was right; the shell was lying.
 *
 * What these mount is the real screens with a real `/api/v1/me` answer,
 * because the interesting cases are all "what does it SAY" rather than
 * "does the guard exist".
 */

const FIELD = {
  id: "u_1",
  name: "Ana Reyes",
  email: "ana@example.test",
  role: "MEMBER",
  jobFunction: "FIELD",
  capabilities: ["MANAGE_FIELD", "MANAGE_JOBS"],
  restricted: true,
  company: { id: "co_1", name: "My Company" },
};

const BOOKKEEPER = {
  ...FIELD,
  name: "Sam Weaver",
  jobFunction: "ACCOUNTING",
  capabilities: ["MANAGE_BILLING", "VIEW_COMPANY_FINANCIALS", "VIEW_JOB_COSTS"],
};

const PAYROLL = { ...FIELD, jobFunction: "PAYROLL_COMPLIANCE", capabilities: ["MANAGE_COMPLIANCE", "MANAGE_FIELD"] };

beforeEach(async () => {
  deviceStore.clear();
  await goOffline();
});

function signedInAs(me: typeof FIELD) {
  vi.mocked(api.getMe).mockResolvedValue(me as never);
}

describe("a screen this person's job function does not include", () => {
  it("says so, instead of showing an empty list", async () => {
    signedInAs(BOOKKEEPER);
    const { default: PunchList } = await import("@/app/punch-list/[jobId]");
    const screen = await mount(<PunchList />);

    expect(screen.text()).toContain("aren't part of your job function");
    expect(screen.text()).toContain("Team page");
    // The empty state must not appear: "Nothing outstanding on this job"
    // to somebody who was never allowed to look is the same lie the
    // offline work spent three rounds killing.
    expect(screen.text()).not.toContain("Nothing outstanding");
    screen.unmount();
  });

  it("opens normally for somebody whose function does include it", async () => {
    signedInAs(FIELD);
    vi.mocked(api.listPunchListItems).mockResolvedValue([
      { id: "p_1", jobId: "job_1", description: "Grid out of level", status: "OPEN", area: null, createdAt: "2026-09-20T12:00:00.000Z" },
    ] as never);
    const { default: PunchList } = await import("@/app/punch-list/[jobId]");
    const screen = await mount(<PunchList />);

    expect(screen.text()).toContain("Grid out of level");
    expect(screen.text()).not.toContain("aren't part of your job function");
    screen.unmount();
  });

  it("is drawn per capability, not per role — payroll gets the field screens and not the drawings", async () => {
    signedInAs(PAYROLL);
    const { default: Drawings } = await import("@/app/drawings/[jobId]");
    const drawings = await mount(<Drawings />);
    expect(drawings.text()).toContain("aren't part of your job function");
    drawings.unmount();

    const { default: Time } = await import("@/app/time/[jobId]");
    const time = await mount(<Time />);
    expect(time.text()).not.toContain("aren't part of your job function");
    time.unmount();
  });
});

describe("the job hub", () => {
  it("offers only the rows this person can open", async () => {
    signedInAs(PAYROLL);
    const { default: JobHub } = await import("@/app/job/[jobId]");
    const screen = await mount(<JobHub />);

    expect(screen.text()).toContain("Field reports");
    expect(screen.text()).toContain("Time");
    // MANAGE_JOBS is what drawings need, and payroll does not hold it.
    expect(screen.text()).not.toContain("Which revision governs");
    screen.unmount();
  });

  it("says plainly when none of it is theirs", async () => {
    signedInAs(BOOKKEEPER);
    const { default: JobHub } = await import("@/app/job/[jobId]");
    const screen = await mount(<JobHub />);

    expect(screen.text()).toContain("Nothing on this job is part of your job function");
    expect(screen.text()).not.toContain("Daily reports");
    screen.unmount();
  });
});

describe("Home", () => {
  it("does not describe a day it was never allowed to read", async () => {
    // Four empty lists the server refused would otherwise come out as
    // "Today's report isn't filed" — a claim about a jobsite, made from a
    // 403.
    signedInAs(BOOKKEEPER);
    deviceStore.set("prova.current-job", JSON.stringify({ id: "job_1", name: "ZZQB-TEST", status: null }));
    const { default: Home } = await import("@/app/(tabs)/index");
    const screen = await mount(<Home />);

    expect(screen.text()).toContain("Today isn't your screen");
    expect(screen.text()).not.toContain("isn't filed");
    screen.unmount();
  });
});

describe("a phone that has never been online", () => {
  it("shows the whole app rather than hiding it from a foreman in a basement", async () => {
    // No /api/v1/me answer and no cache of one. Hiding everything would
    // be a dead phone; the server still refuses anything this person may
    // not do, and that refusal is one honest sentence.
    const { default: PunchList } = await import("@/app/punch-list/[jobId]");
    const screen = await mount(<PunchList />);
    expect(screen.text()).not.toContain("aren't part of your job function");
    screen.unmount();
  });
});
