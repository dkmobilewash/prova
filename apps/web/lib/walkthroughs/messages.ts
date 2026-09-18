import type { Walkthrough } from "./types";

/** /messages — everything the app has emailed for you, and whether it arrived. */
export const messagesWalkthrough: Walkthrough = {
  route: "/messages",
  title: "Sent messages",
  steps: [
    {
      anchor: "messages-setup",
      title: "Email is not switched on yet",
      body:
        "The app cannot send email until it is set up with your own company address. Whoever set up your account needs to finish this before anything can go out.",
    },
    {
      anchor: "messages-compose",
      title: "Send an email",
      body:
        "Press Send an email, type who it goes to, pick the job if it is about one, write it, and press Send. It is kept here with everything else you sent.",
    },
    {
      anchor: "messages-filter",
      title: "Find the ones that went wrong",
      body:
        "Press Needs attention to see only emails that bounced, were marked as spam, or have had no word back. Everything shows them all.",
    },
    {
      anchor: "messages-empty",
      title: "Nothing here",
      body:
        "Every email the app sends for you is listed here, with whether it got there.",
    },
    {
      anchor: "messages-list",
      title: "Did it arrive",
      body:
        "Each email shows who it went to and what happened to it — Delivered, Bounced, or No word back yet. Press Show what was sent to read it again.",
    },
  ],
};
