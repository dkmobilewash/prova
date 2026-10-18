import type { Walkthrough } from "./types";

/** /ai — the chat, and what the background agents are doing about your bids. */
export const aiWalkthrough: Walkthrough = {
  route: "/ai",
  title: "AI",
  steps: [
    {
      anchor: "ai-chat",
      title: "Ask, or tell it what to do",
      body:
        "Ask about a bid, a job or your money in plain words. If you ask it to change or send something, it shows you exactly what first, and nothing happens until you confirm.",
    },
    {
      anchor: "ai-running",
      title: "What the agents are doing",
      body:
        "Agents read your bids on a schedule, when a bid is logged, or when you press Run now. Each line says what it did and when.",
    },
    {
      anchor: "ai-recommendations",
      title: "What is worth doing next",
      body:
        "Each card says why, and links the records it read. Open it to act, or press Done or Dismiss to clear it.",
    },
    {
      anchor: "ai-watching",
      title: "Bids being watched",
      body:
        "Your open bids due this week, unread addenda, and anything the agents flagged. Tap a bid to open its AI workspace.",
    },
  ],
};
