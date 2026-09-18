import type { Walkthrough } from "./types";

/** /dashboard — the "Today" page, which is also the jobs list and the
 * estimating list (/jobs and /estimating both redirect here). */
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
      anchor: "dashboard-ask",
      title: "Ask in plain words",
      body:
        "Type a question, like “what's overdue?”, or tell it to do something, like “start a job for the Smith kitchen”. If it is going to add or change anything, it shows you first and waits for you to press the button.",
    },
    {
      anchor: "dashboard-needs-attention",
      title: "What needs you",
      body:
        "A quick count of things to look at: unpaid invoices past their due date, papers about to expire, and jobs heading over budget. Zero means you are fine.",
    },
    {
      anchor: "dashboard-field",
      title: "Today in the field",
      body:
        "Which jobs are under way and who is on each one, plus any licences or certificates that are running out. Tap a job to open it.",
    },
    {
      anchor: "dashboard-money",
      title: "Who owes you",
      body:
        "Invoices still waiting to be paid, the longest overdue first, and how quickly each client has paid you in the past.",
    },
    {
      anchor: "dashboard-job-health",
      title: "Is each job on budget?",
      body:
        "One line per active job, saying whether it looks like finishing over or under what the client is paying. Tap a line to see the job.",
    },
    {
      anchor: "dashboard-new-job",
      title: "Start a new job",
      body:
        "Every estimate starts as a job. Press New job, give it a name and say who it is for — then you can price it.",
    },
    {
      anchor: "dashboard-job-filters",
      title: "Find a job",
      body:
        "These buttons show jobs at one stage — Estimating is everything you are still pricing. Or type a job or client name in the search box.",
    },
    {
      anchor: "dashboard-jobs-empty",
      title: "No jobs yet",
      body:
        "Your jobs will be listed here. Press “create a job” to add your first one, or bring a spreadsheet of them in from Settings.",
    },
    {
      anchor: "dashboard-job-list",
      title: "Your jobs",
      body:
        "Every job, grouped by where it is: estimating, contracted, in progress, complete. The small tag on an estimate says what it still needs, like “Needs pricing”. Tap a job to open it.",
    },
  ],
};
