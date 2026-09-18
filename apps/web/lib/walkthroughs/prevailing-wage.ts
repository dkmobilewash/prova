import type { Walkthrough } from "./types";

/** /prevailing-wage — the overtime rules a jurisdiction sets, checked against logged hours. */
export const prevailingWageWalkthrough: Walkthrough = {
  route: "/prevailing-wage",
  title: "Prevailing wage rules",
  steps: [
    {
      anchor: "pw-check-week",
      title: "Check a week",
      body:
        "Tap a job and week to compare the hours your crew logged against the rules for that job. Each day that does not match is listed so a person can decide which one is wrong.",
    },
    {
      anchor: "pw-which-job",
      title: "Which rules go with which job",
      body:
        "Every prevailing wage job is listed here once its wage determination is uploaded on the job. Use the menu on a line to pick the rule set that applies.",
    },
    {
      anchor: "pw-record-rules",
      title: "Record a rule set",
      body:
        "Press Record a rule set and type the rules from the awarding body's own papers — when overtime starts, when double time starts, when the report is due. Leave blank anything you have not looked up.",
    },
    {
      anchor: "pw-rule-sets",
      title: "Your rule sets",
      body: "Each rule set you have recorded. Press Edit on one to change it when the rules change.",
    },
  ],
};
