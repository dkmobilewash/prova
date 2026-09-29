import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { deviceStore, goOffline, setCanGoBack, stackScreenOptions } from "./setup";
import { mount } from "./render";

/**
 * The job hub's way out of a cold notification tap.
 *
 * `/job/<id>` is the SECOND of the two destinations a push can open
 * (`push-target.ts:19`, from `assignCrewMember`'s `{ jobId }`), and it sits
 * outside `(tabs)` exactly as `/alerts` does. #548 fixed the dead end on
 * `/alerts` because that was the screen somebody got trapped on; this
 * screen had the identical defect and nothing had looked.
 *
 * It is the more likely of the two to be met in the wild, which is the part
 * worth knowing: the digest push is gated by the milestone ledger and fires
 * once per rung over a document's life, while the assignment push has no
 * ledger at all and goes out every time somebody is added to a job.
 *
 * Pinned in the same shape as `alerts.test.tsx` on purpose — a stranded
 * case and a NOT-stranded control — so the two screens cannot drift into
 * disagreeing about what a cold start means.
 */

const FOREMAN = {
  id: "u_1",
  name: "Ana Reyes",
  email: "ana@example.test",
  role: "MEMBER",
  jobFunction: "FIELD",
  capabilities: ["MANAGE_FIELD", "MANAGE_JOBS"],
  restricted: true,
  company: { id: "co_1", name: "My Company" },
};

beforeEach(async () => {
  deviceStore.clear();
  await goOffline();
  vi.mocked(api.getMe).mockResolvedValue(FOREMAN as never);
});

async function open() {
  const { default: JobHub } = await import("@/app/job/[jobId]");
  return mount(<JobHub />);
}

describe("getting out of the job hub", () => {
  it("offers a way home when a cold tap left nothing to go back to", async () => {
    stackScreenOptions.length = 0;
    setCanGoBack(false);
    const screen = await open();

    // "At least one", not "exactly one": the screen re-renders as its own
    // reads resolve, so how many times it states its options is a fact
    // about React rather than about the header.
    const withHeader = stackScreenOptions.filter((o) => "headerLeft" in o);
    expect(
      withHeader.length,
      "stranded on /job/<id> after an assignment push — no back chevron, no tab bar, and this is the push that actually arrives",
    ).toBeGreaterThan(0);
    expect(typeof withHeader[0].headerLeft).toBe("function");
    screen.unmount();
  });

  it("leaves the ordinary Back alone when there IS history behind it", async () => {
    // The control, and it is the half that stops the fix applying itself
    // everywhere: opening a job from the jobs list gives a real back
    // chevron, and two competing ways out of one screen is its own
    // confusion. Without this test, `stranded = true` would pass.
    stackScreenOptions.length = 0;
    setCanGoBack(true);
    const screen = await open();

    expect(
      stackScreenOptions.filter((o) => "headerLeft" in o),
      "overrode the back chevron on a screen that already had one",
    ).toEqual([]);
    screen.unmount();
  });

  it("still renders the job's features either way", async () => {
    // A guard against the cheapest wrong fix: wrapping the screen in a
    // fragment and breaking what it was already doing. If this screen ever
    // renders empty, the two assertions above would still both pass.
    stackScreenOptions.length = 0;
    setCanGoBack(false);
    const screen = await open();

    // Row titles rather than the section headings: `SectionHeader`
    // uppercases its text, so asserting "The day" would be pinning a
    // styling decision and would fail for a reason that is not this fix.
    expect(screen.text()).toContain("Field reports");
    expect(screen.text()).toContain("Punch list");
    screen.unmount();
  });
});
