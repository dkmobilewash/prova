import type { Walkthrough } from "./types";

/** /dashboard — the "Today" page. The full jobs list is /jobs. */
export const dashboardWalkthrough: Walkthrough = {
  route: "/dashboard",
  title: "Today and your jobs",
  steps: [
    {
      anchor: "dashboard-getting-started",
      title: "Start here",
      body:
        "These are the few things to set up first. Each line has a link that takes you to the right page, and the tick fills in by itself once it is done. When you are finished, press Hide this.",
    },
    {
      anchor: "dashboard-new-job",
      title: "Start a new job",
      body:
        "Every estimate starts as a job. Press New job, give it a name and say who it is for — then you can price it. The buttons beside it go straight to logging hours, sending a pay app or finding an RFI.",
    },
    {
      anchor: "dashboard-ask",
      title: "Search, or ask in plain words",
      body:
        "Press here to find any job, RFI, pay app or person — or type a question, like “what's overdue?”, or tell it to do something, like “start a job for the Smith kitchen”. If it is going to add or change anything, it shows you first and waits for you to press the button.",
    },
    {
      anchor: "dashboard-needs-attention",
      title: "Needs you today",
      body:
        "Everything waiting on you, one line each: invoices past due, RFI answers that are late, hours to approve, papers about to expire and jobs heading over budget. The link at the end of a line takes you to where you settle it.",
    },
    {
      anchor: "dashboard-field",
      title: "Crews today",
      body:
        "Who is on the schedule today, job by job. Tap a job to log their hours. If nobody is scheduled, it says so and takes you to the schedule.",
    },
    {
      anchor: "dashboard-money",
      title: "Money",
      body:
        "What you billed and collected this month, the retainage still held back, and what is overdue. Further down: every unpaid invoice, and how quickly each client has paid you in the past.",
    },
    {
      anchor: "dashboard-job-health",
      title: "Your jobs",
      body:
        "A card per job: where it has got to, from estimate to closeout, and the one thing to do next on it. A job heading over budget says so on its card.",
    },
    {
      anchor: "dashboard-jobs-empty",
      title: "No jobs yet",
      body:
        "Your jobs will be listed here, and the rest of this page fills in once there is one. Press “Start your first job”, or bring a spreadsheet of them in. The faded rows underneath are only an example.",
    },
  ],
};
