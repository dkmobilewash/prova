import type { Walkthrough } from "./types";

/** /alerts — every date nobody has dealt with yet, worst first. */
export const alertsWalkthrough: Walkthrough = {
  route: "/alerts",
  title: "Your alerts",
  steps: [
    {
      anchor: "alerts-empty",
      title: "Nothing to chase yet",
      body:
        "This page only watches dates you have typed in, so a new account starts empty. Put in your insurance and licence dates, or add a job, and anything coming due shows up here.",
    },
    {
      anchor: "alerts-list",
      title: "What needs you",
      body:
        "Each line is something with a date on it that nobody has dealt with — the worst and the most money first. Press Go and fix it to open the thing itself; fixing it is what makes the line go away.",
    },
    {
      anchor: "alerts-silenced",
      title: "Put one aside",
      body:
        "Snooze on a line hides it until a date you pick, and Seen it hides it for good. Show silenced lists the ones you hid, so you can put one back.",
    },
    {
      anchor: "alerts-email",
      title: "Get them by email",
      body:
        "Press Email these to me to get this list in your inbox. You are emailed once per thing, not every day.",
    },
  ],
};
