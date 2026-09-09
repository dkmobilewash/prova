import type { ActionResult } from "@/lib/actions/shared";

/**
 * How a command calls a Server Action that was written for a form.
 *
 * Cyrus's modules take `FormData` and RETURN their failures as
 * `ActionResult`, which is exactly the shape a card can show — the
 * sentence on the card is the action's own ("that lift is already out on
 * Maple"). So a DIRECT command over one of them builds the FormData the
 * form would have posted and calls the function in-process. The action's
 * own guards run unchanged: its `requireCompanyContext()`, its `can()`,
 * its overlap check inside its transaction. Nothing here re-implements a
 * rule; it only speaks the form's dialect.
 *
 * The dialect, from reading the modules rather than guessing: checkboxes
 * are the literal string "on"; an absent optional field is simply absent;
 * dates are `yyyy-mm-dd`; repeated fields are appended, not joined.
 */
export type FormFields = Record<string, string | boolean | string[] | null | undefined>;

export function formDataFrom(fields: FormFields): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === false) continue;
    if (value === true) {
      formData.set(key, "on");
    } else if (Array.isArray(value)) {
      for (const entry of value) formData.append(key, entry);
    } else {
      formData.set(key, value);
    }
  }
  return formData;
}

/**
 * Runs an ActionResult action and turns a THROW into a sentence.
 *
 * The actions this adapter calls return their expected failures, so a
 * throw here is a genuine bug, not a refusal. It is caught rather than
 * propagated because the card has to say something, and "check the page
 * before trying again" is the honest something: a throw after a partial
 * write is possible in principle, and a sentence claiming nothing was
 * saved would be a claim the adapter cannot back.
 */
export async function throughAction(
  verb: string,
  run: () => Promise<ActionResult>,
): Promise<ActionResult> {
  try {
    return await run();
  } catch (err) {
    console.error(`[ask] ${verb} threw inside its action`, err);
    return {
      ok: false,
      error: `${verb} did not complete. Check the page before trying again.`,
    };
  }
}
