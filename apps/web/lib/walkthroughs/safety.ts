import type { Walkthrough } from "./types";

/** /safety — the incident log and the toolbox talk record. */
export const safetyWalkthrough: Walkthrough = {
  route: "/safety",
  title: "Safety",
  steps: [
    {
      anchor: "safety-record-incident",
      title: "Write down an injury",
      body:
        "Press Record an incident the same day someone gets hurt, even if it is only first aid. Put in who, where, what happened and how it turned out.",
    },
    {
      anchor: "safety-log-talk",
      title: "Log a toolbox talk",
      body:
        "Press Log a toolbox talk after each safety meeting. Put in the date, the topic and who was there — the written record is what a GC or inspector asks to see.",
    },
    {
      anchor: "safety-incident-log",
      title: "Your incident log",
      body:
        "Every case for the year, each with its own case number. Cases marked Recordable are the ones that go on your OSHA log.",
    },
    {
      anchor: "safety-years",
      title: "Other years",
      body: "Tap a year to see that year's cases.",
    },
    {
      anchor: "safety-talks",
      title: "Toolbox talks",
      body: "Every safety meeting you have logged, newest first.",
    },
  ],
};
