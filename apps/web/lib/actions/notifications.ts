"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { requireCompanyContext } from "@/lib/auth";
import { dispatchAlertDigest } from "@/lib/notification-dispatch";
import { dispatchAlertPush } from "@/lib/notification-push";
import { viewerToday } from "@/lib/viewerToday";
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
 *
 * NOT SAFE FOR A SCHEDULED SEND, and the reason is worth reading before
 * reusing it. This value becomes the host of every link in the email
 * body, and a request header is something the caller controls. That is
 * harmless here ONLY because this action mails the person who clicked and
 * nobody else — the worst they can do is point their own links somewhere
 * odd. A cron mailing other people must pass a host it knows, from
 * configuration, not from whatever arrived on a request.
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

  // The reader's own calendar day, which this comment used to say was not
  // available on a server action. It is now -- the browser parks its zone
  // in a cookie and lib/viewerToday.ts reads it (issue #111 item 1). The
  // point of using it here is unchanged: the digest has to agree with the
  // page that raised it, and /alerts is dated this way too.
  const today = await viewerToday();

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

  // The push half is independent of the email outcome: its own claim
  // namespace, its own config. Still fire-and-forget as far as the caller
  // is concerned — this button's result keeps speaking for the email —
  // but `after` rather than `void`, and the difference is the whole bug.
  //
  // WHY. This was `void dispatchAlertPush(...)`, and the push never once
  // arrived while the email always did. A floating promise in a server
  // action is not "later", it is "until the response is sent": Vercel may
  // tear the function down the moment this action returns, and whatever
  // the promise had left to do dies with it. `dispatchAlertPush` makes
  // FIVE database round-trips — device tokens, loadAlerts, sent keys,
  // claim, release — before it ever reaches `pushToUser`, so its window
  // is hundreds of milliseconds wide.
  //
  // The control that named it: `assignCrewMember` is ALSO fire-and-forget
  // (`void pushToUser(...)`, lib/actions/jobs.ts) and its push DOES
  // arrive — because it is one HTTP call with a millisecond-wide window.
  // Same shape, different odds. Both pushes were sent to the same phone
  // 49 minutes apart on 2026-09-27; one landed and one did not, which is
  // what ruled out the token, the key, the permission and the transport.
  //
  // It also explains the silence. Nothing was ever logged about the push
  // failing, because nothing was alive to log it — so this bug could not
  // be found from the server's own output, only by missing the banner.
  //
  // `after` keeps the response immediate and keeps the work alive until
  // it finishes. The cron path never had this bug: `notification-run.ts`
  // AWAITS `pushDispatch`, which is why the schedule was never suspect.
  after(() =>
    dispatchAlertPush(
      { id: user.id, companyId: company.id, role: user.role, jobFunction: user.jobFunction },
      today,
    ),
  );

  revalidatePath("/alerts");
  revalidatePath("/messages");

  // An unconfigured provider is a setup problem, not a send failure, and
  // nothing was consumed — so the message says what to do rather than
  // implying the notices are gone.
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
