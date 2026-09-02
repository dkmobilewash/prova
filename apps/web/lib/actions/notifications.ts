"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireCompanyContext } from "@/lib/auth";
import { dispatchAlertDigest } from "@/lib/notification-dispatch";
import {
  actionFail as fail,
  actionOk as ok,
  type ActionResult,
} from "./shared";

/** Actions here RETURN their failures. Production redacts thrown Server
 * Action messages to a digest, and "your email didn't send" is exactly the
 * sentence a person has to be able to read. */

/**
 * The app's own origin, for links that have to survive leaving the app.
 *
 * Read from the request rather than an environment variable because there
 * isn't one, and inventing one would be a third place the host is
 * configured. `x-forwarded-host` is what Vercel sets behind its proxy;
 * `host` is what a local dev server sets.
 */
async function originFromRequest(): Promise<string> {
  const list = await headers();
  const host =
    list.get("x-forwarded-host") ?? list.get("host") ?? "app.cstream.ai";
  const protocol =
    list.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

/**
 * Emails the person doing the clicking whatever they have not been told.
 *
 * Deliberately only ever sends to YOURSELF. A button that emails a
 * colleague their own compliance alerts is a different feature with a
 * different consent question attached, and this one exists so that the
 * sending path can be exercised by a person on demand rather than only by
 * a schedule nobody can watch.
 *
 * Idempotent by construction. Clicking it twice sends one email and then
 * says there is nothing left — which is the whole property this feature is
 * built on, and the fastest way to see it working.
 */
export async function sendMyAlertDigest(): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();

  if (!user.email) {
    return fail(
      "Your account has no email address on it, so there is nowhere to send this.",
    );
  }

  // The user's own calendar day would be better and is not available on a
  // server action; UTC matches how every date in this app is stored and
  // compared, so a digest agrees with the page that raised it.
  const today = new Date().toISOString().slice(0, 10);

  const outcome = await dispatchAlertDigest(
    {
      id: user.id,
      companyId: company.id,
      email: user.email,
      name: user.name,
      role: user.role,
      jobFunction: user.jobFunction,
    },
    today,
    await originFromRequest(),
  );

  revalidatePath("/alerts");
  revalidatePath("/messages");

  if (!outcome.ok) return fail(outcome.error);

  if (!outcome.sent) {
    return outcome.reason === "nothing-due"
      ? fail(
          "Nothing new to send — everything on this list has already gone out to you once.",
        )
      : fail("Another run is sending these right now.");
  }

  return ok;
}
