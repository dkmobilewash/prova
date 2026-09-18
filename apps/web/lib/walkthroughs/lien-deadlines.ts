import type { Walkthrough } from "./types";

/** /lien-deadlines — the dates that keep your right to get paid. */
export const lienDeadlinesWalkthrough: Walkthrough = {
  route: "/lien-deadlines",
  title: "Lien deadlines",
  steps: [
    {
      anchor: "lien-totals",
      title: "The counts",
      body:
        "How many deadlines have passed without being served, how many are due in the next two weeks, and how many are done. A red box means you may be about to lose lien rights.",
    },
    {
      anchor: "lien-add",
      title: "Add a deadline",
      body:
        "Press Add a deadline, pick the job and what kind of notice it is, and type the date your lawyer or the law gives you. The app never works these dates out for you. The button stays grey until you have a job.",
    },
    {
      anchor: "lien-empty",
      title: "Nothing entered yet",
      body:
        "An empty list means no dates have been typed in, not that none are running. Add each one as soon as you know it.",
    },
    {
      anchor: "lien-open",
      title: "Still to serve",
      body:
        "Soonest first, with how many days are left. Once the notice goes out, press Mark served and enter the date on the proof.",
    },
    {
      anchor: "lien-served",
      title: "Done",
      body: "Notices already served stay here, with their dates, as your record.",
    },
  ],
};
