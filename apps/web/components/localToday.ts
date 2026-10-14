import { useEffect, useState } from "react";

/** The date on the USER'S calendar, not the server's.
 *
 * Dates are stored and rendered at UTC midnight, which is right. But
 * deciding what day it *is* in UTC is wrong for anyone west of it: at
 * 17:00 in Los Angeles the UTC date is already tomorrow, so a date input
 * defaulted from the server would pre-fill tomorrow and a foreman filing
 * an incident at the end of a shift would date it a day late — or, on
 * 31 December, into the wrong year, which on a safety log also picks the
 * wrong case-number series.
 *
 * Safe to call during render ONLY in components that are mounted by a
 * user action (collapsed forms opened by a click), never in markup that
 * is server-rendered, or the two disagree and hydration breaks.
 */
export function localToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** `localToday()` for a form that can be in SERVER-RENDERED markup — one
 * opened on arrival by `startOpen` (`?new=1`), so no click mounted it.
 *
 * "" on the server and in the hydration render, so the two agree; the
 * user's date one effect later. Use it as an uncontrolled input's
 * `defaultValue`: React writes the new default onto the element, and an
 * input nobody has typed in (or had a draft restored into) shows it.
 * `startOpenDateCensus.test.ts` fails the build if a startOpen form calls
 * `localToday()` in render instead. */
export function useLocalToday() {
  const [today, setToday] = useState("");
  useEffect(() => setToday(localToday()), []);
  return today;
}
