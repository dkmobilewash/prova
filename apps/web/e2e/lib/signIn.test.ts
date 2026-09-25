import { describe, expect, it } from "vitest";
import { failOnSessionTask } from "./signIn";

/**
 * A Clerk session task is the failure mode that costs the most and says
 * the least: sign-in SUCCEEDS, the session is held, the app renders
 * nothing, and every spec downstream fails on its own assertion.
 *
 * On 2026-09-24 that read as twenty-four separate bugs — a 120-second
 * timeout on `1. sign in`, `toBeVisible` failures on six empty states,
 * fixture timeouts at 180s — with one instance setting underneath and
 * nothing anywhere naming it.
 *
 * `page` is stubbed to its one method here on purpose: the check is a
 * pure function of the URL, and a test that needed a real browser to
 * prove that would not be run.
 */
const pageAt = (url: string) => ({ url: () => url }) as unknown as Parameters<typeof failOnSessionTask>[0];

const EMAIL = "e2e-empty+clerk_test@example.com";

describe("a session task fails immediately and names itself", () => {
  it("lets a normal signed-in URL through untouched", async () => {
    await expect(failOnSessionTask(pageAt("http://localhost:3100/dashboard"), EMAIL)).resolves.toBeUndefined();
    await expect(failOnSessionTask(pageAt("http://localhost:3100/jobs/new"), EMAIL)).resolves.toBeUndefined();
  });

  it("does not fire on the ordinary sign-in page", async () => {
    // /sign-in is where every caller starts. Only /sign-in/tasks is a task.
    await expect(failOnSessionTask(pageAt("http://localhost:3100/sign-in"), EMAIL)).resolves.toBeUndefined();
    await expect(
      failOnSessionTask(pageAt("http://localhost:3100/sign-in?redirect_url=%2Fdashboard"), EMAIL),
    ).resolves.toBeUndefined();
  });

  it("catches choose-organization and says it is an instance setting", async () => {
    const url = "http://localhost:3100/sign-in/tasks/choose-organization?redirect_url=%2Fdashboard";
    await expect(failOnSessionTask(pageAt(url), EMAIL)).rejects.toThrow(/choose-organization/);

    const error = await failOnSessionTask(pageAt(url), EMAIL).catch((e: Error) => e);
    const text = (error as Error).message;

    // The three things that turn this from a mystery into a two-minute fix.
    //
    // Asserted against the message with its line breaks collapsed. Twice
    // today a test asserted an exact phrase against text that is
    // hard-wrapped for a CI log and failed on WHERE IT WRAPPED rather than
    // on a missing idea — a test that breaks when you reflow a paragraph
    // is measuring the wrong thing.
    const flat = text.replace(/\s+/g, " ");
    expect(flat, "must say where the fix is").toMatch(/Configure → Organizations/);
    expect(flat, "must say the app cannot satisfy it").toMatch(/does not use Clerk organizations/);
    expect(flat, "must say which instance").toMatch(/DEVELOPMENT/);
    expect(flat, "must name the persona").toContain(EMAIL);
  });

  it("catches a task it has never heard of, rather than only the known one", async () => {
    // The mutation this guards: hard-coding the check to the string
    // "choose-organization". Clerk adds tasks; an unknown one must still
    // fail loudly instead of falling through to a 120-second timeout.
    const url = "http://localhost:3100/sign-in/tasks/some-future-task?redirect_url=%2Fdashboard";
    await expect(failOnSessionTask(pageAt(url), EMAIL)).rejects.toThrow(/some-future-task/);
  });

  it("catches the bare /sign-in/tasks URL with no task name", async () => {
    // Observed in the same run, on the specs that were not the journey:
    // /sign-in/tasks?redirect_url=… with no segment after it.
    const url = "http://localhost:3100/sign-in/tasks?redirect_url=%2Fjobs%2Fnew";
    await expect(failOnSessionTask(pageAt(url), EMAIL)).rejects.toThrow(/SESSION TASK/);
  });
});
