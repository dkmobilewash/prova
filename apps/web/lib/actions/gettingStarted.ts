"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import {
  GETTING_STARTED_HIDDEN_COOKIE,
  GETTING_STARTED_HIDDEN_MAX_AGE,
} from "@/lib/getting-started-cookie";
import { actionOk, type ActionResult } from "./shared";

/**
 * Hides the getting-started card on this browser, for this company.
 *
 * Writes no row. The company id comes from the session, never from the
 * form, so the cookie can only ever name the caller's own company. The
 * revalidate re-renders /dashboard on the server with the cookie in place,
 * which is what removes the card — the client does not remove it itself.
 */
export async function hideGettingStarted(): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  const store = await cookies();
  store.set(GETTING_STARTED_HIDDEN_COOKIE, company.id, {
    path: "/",
    maxAge: GETTING_STARTED_HIDDEN_MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/dashboard");
  return actionOk;
}
