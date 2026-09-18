import type { Walkthrough } from "./types";

/** /material-orders — what is on order, from whom, and whether it showed up. */
export const materialOrdersWalkthrough: Walkthrough = {
  route: "/material-orders",
  title: "Material orders",
  steps: [
    {
      anchor: "material-orders-log",
      title: "Log an order the day you place it",
      body:
        "Press Log an order, pick the job and the supplier, say what you ordered and the date they promised it. With no jobs or no suppliers yet, this box sends you to add one first.",
    },
    {
      anchor: "material-orders-job-filter",
      title: "One job at a time",
      body: "Tap a job to see only its orders. All jobs shows every one.",
    },
    {
      anchor: "material-orders-empty",
      title: "Nothing on order",
      body:
        "Orders you log will be listed here until they arrive. Press Show delivered to see the ones that already came.",
    },
    {
      anchor: "material-orders-list",
      title: "Did it show up",
      body:
        "Each order shows the supplier, the promised date, and how many days late it is. Press Record delivery when it arrives — a delivered order drops off the list.",
    },
  ],
};
