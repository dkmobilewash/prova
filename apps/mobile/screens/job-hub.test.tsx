import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { deviceStore, goOffline } from "./setup";
import { mount } from "./render";

/**
 * The job hub — the second of the two screens a notification can
 * cold-start (`push-target.ts:19`, from `assignCrewMember`'s `{ jobId }`).
 *
 * **The way-out assertions that used to live here have been deleted, and
 * the deletion is the point.** They mounted this screen, set `canGoBack`
 * false, and checked that it recorded a `headerLeft` option — which it did,
 * honestly, in a mock. On a real phone React Navigation dropped that call,
 * so the test vouched for a fix that did nothing. A green test asserting on
 * a mechanism the framework ignores is worse than no test: it is why two
 * releases shipped believing this was fixed.
 *
 * The way home now lives in `app/_layout.tsx` and is covered in two halves
 * that can each actually fail: the DECISION in `screens/way-home.test.tsx`
 * (pure, no navigator) and the DELIVERY in
 * `lib/push-destination-exit.test.ts` (the layout declares it for every
 * push destination, and the screens must not take it back).
 *
 * What is left here is what this suite can honestly see: the screen renders
 * its features. Keep it — the cheapest wrong fix to a header problem is one
 * that quietly breaks the body.
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

describe("the job hub", () => {
  it("renders the job's field features", async () => {
    const { default: JobHub } = await import("@/app/job/[jobId]");
    const screen = await mount(<JobHub />);

    // Row titles rather than the section headings: `SectionHeader`
    // uppercases its text, so asserting "The day" would pin a styling
    // decision and fail for a reason that is not about this screen.
    expect(screen.text()).toContain("Field reports");
    expect(screen.text()).toContain("Punch list");
    screen.unmount();
  });
});
