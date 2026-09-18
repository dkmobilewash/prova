import type { Walkthrough } from "./types";

/** /ask — the assistant, on a page of its own. */
export const askWalkthrough: Walkthrough = {
  route: "/ask",
  title: "The assistant",
  steps: [
    {
      anchor: "ask-panel",
      title: "Ask in plain words",
      body:
        "This reads your jobs, money, schedule and papers and answers in plain words. It can also do things for you, like start a job or add a contact — but it always shows you what it will change first, and nothing is saved until you press its button.",
    },
    {
      anchor: "ask-box",
      title: "Type or talk",
      body:
        "Type here and press Ask. If you see a microphone button, you can tap it and say it out loud instead. For example: “start a job called Smith kitchen for Jane Smith”.",
    },
  ],
};
