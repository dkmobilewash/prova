/**
 * WHO THE HIRING-HALL DISPATCH FORM WILL OFFER.
 *
 * The form's select was built from `User` rows and named `employeeUserId`, so
 * the only people a dispatch could be logged for were people who had
 * completed a sign-up. A hiring hall dispatches FIELD CREW — `CrewMember`
 * rows with no login — which made the people the form exists for the one
 * group it could not record. #412 fixed the identical dead end for time
 * entry; this pins the same fix here.
 *
 * Three things are needed together, and each alone reads as a fix:
 *
 *   - the options come from the SAME builder the time-entry form uses
 *     (`workerOptions`), so a crew member is offered and labelled "(crew)";
 *   - the select is named `worker`, because a crew id posted as
 *     `employeeUserId` is looked up in `User` and refused — a fix that reads
 *     correct and behaves exactly like the bug;
 *   - what is submitted is the prefixed value, so the action knows the table.
 *
 * Written with createElement rather than JSX because the suite's `include`
 * matches .test.ts and not .test.tsx.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { workerOptions } from "@/lib/worker-select";

vi.mock("@/lib/actions", () => ({ uploadDispatchSlip: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { DispatchSlipForm } = await import("./DispatchSlipForm");

const workers = workerOptions(
  [{ id: "ana", name: "Ana Reyes", email: "ana@example.com" }],
  [{ id: "luis", legalFirstName: "Luis", legalMiddleName: null, legalLastName: "Ortega" }],
);

function render() {
  return renderToStaticMarkup(createElement(DispatchSlipForm, { jobId: "northgate", workers, crafts: [] }));
}

describe("the hiring-hall dispatch form", () => {
  it("offers crew members, labelled (crew) the way time entry does", () => {
    const html = render();
    expect(html).toContain('<option value="crew:luis">Luis Ortega (crew)</option>');
    expect(html).toContain('<option value="user:ana">Ana Reyes (signs in)</option>');
  });

  it("posts the worker under a field name that admits they are not users", () => {
    const html = render();
    expect(html).toContain('name="worker"');
    expect(html).not.toContain('name="employeeUserId"');
  });
});

describe("workerOptions", () => {
  it("lists teammates first, then crew, each with the table it names", () => {
    expect(workers).toEqual([
      { value: "user:ana", label: "Ana Reyes (signs in)" },
      { value: "crew:luis", label: "Luis Ortega (crew)" },
    ]);
  });

  it("falls back to the email for a teammate with no name", () => {
    expect(workerOptions([{ id: "x", name: null, email: "x@example.com" }], [])).toEqual([
      { value: "user:x", label: "x@example.com (signs in)" },
    ]);
  });
});

/**
 * The form offering crew is only half of it: the Crew & time tab has to HAND
 * it crew. It was handed `companyMembers` — logins only — so this pins that
 * the dispatch form and the time-entry form receive the one list built by
 * `workerOptions`. A source read, because the page is an async server
 * component that queries Prisma and cannot be rendered here.
 */
describe("the Crew & time tab", () => {
  const page = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../app/(app)/jobs/[id]/(tabs)/crew/page.tsx"),
    "utf8",
  );

  it("builds one worker list with workerOptions and gives it to both forms", () => {
    const built = page.match(/const (\w+) = workerOptions\(/);
    expect(built, "the page no longer builds its worker list with workerOptions").not.toBeNull();
    const list = built![1];
    const handed = page.match(new RegExp(`workers=\\{${list}\\}`, "g")) ?? [];
    // LogTimeEntryForm and DispatchSlipForm.
    expect(handed).toHaveLength(2);
    const dispatch = page.slice(page.indexOf("<DispatchSlipForm"));
    expect(dispatch.slice(0, dispatch.indexOf("/>"))).toContain(`workers={${list}}`);
  });
});
