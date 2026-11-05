import type { CommandName } from "@/lib/ask/commands";
/**
 * What the ask box offers before anybody types.
 *
 * A PLAIN MODULE, not part of `AskPanel.tsx`, and for the reason CLAUDE.md
 * already records against `Hint.tsx`: a constant exported from a
 * `"use client"` file arrives across the RSC boundary as a client-reference
 * proxy rather than as its value, and `client-boundary.test.ts` is right to
 * fail on it. `components/hintTiming.ts` is the same shape and the same
 * fix — the constant lives beside the component, never inside it.
 *
 * THE OLDER RULE THESE WERE WRITTEN UNDER STILL HOLDS: each one must be
 * something this app can actually do, because an example that comes back
 * with "I don't have that" teaches people the feature does not work. And
 * none of them names a specific job — one did once, the job did not exist
 * in the data, and a chip asking about a job you do not have is the same
 * broken promise wearing a worked example.
 *
 * WHAT CHANGED, 2026-09-16. Every example used to be a QUESTION. So the
 * first thing anyone learned about this box was that it answers things,
 * while sixteen commands sat behind it that nobody had any reason to
 * suspect. A construction manager reviewing the app concluded the assistant
 * could not act at all — off one correct answer about a record type that
 * does not exist — and he was reading the only evidence he had.
 *
 * Two of the four are now INSTRUCTIONS. Both still obey the rule above:
 *
 *   - "Start an estimate for a new job" requires nothing that must already
 *     exist. A name is the only required input.
 *   - "Log today's field report" resolves the job from the page when you
 *     are standing on one, and otherwise asks which — the clarify path
 *     working, not a broken promise. A question back is not a failure.
 */
export const EXAMPLES = [
  "What's overdue and who do I chase first?",
  "Which drawings am I not building to the latest revision of?",
  "Start an estimate for a new job",
  "Log today's field report",
  "Anything expiring I should renew?",
  // The one chip a brand-new account can always use: it routes to the
  // getting_started tool, which answers per person from the dashboard
  // card's own steps. Every other chip assumes something exists.
  "What should I set up first?",
] as const;

/** Question words an example can open with. Anything not starting with one
 * of these is an instruction — which is the property the census below
 * actually cares about, since "does this box do things" is answered by
 * shape long before anybody reads the words. */
const QUESTION_OPENERS = [
  "what", "which", "who", "when", "where", "why", "how",
  "is", "are", "do", "does", "did", "can", "should", "anything", "any",
];

export function isInstruction(example: string): boolean {
  const first = example.trim().toLowerCase().split(/[\s']/)[0];
  return !QUESTION_OPENERS.includes(first);
}

/**
 * What you can SAY, by workflow — the empty panel's second half.
 *
 * The flat chips above say the box can act; these say WHAT it acts on, in
 * the shop's own nouns. Each example names the command it is written to
 * reach, typed as `CommandName`, so an example for a command that does not
 * exist fails typecheck rather than reaching somebody as "I don't have
 * that". Each phrasing is also a routing-eval case (`example-*` in
 * lib/ask/eval/cases.ts), so "written to reach" is measured, not hoped.
 *
 * Unlike EXAMPLES, a tap FILLS the box rather than sending, so the person
 * adds the job by voice or by typing, and edits the vendor or pay app
 * number, which the PO and waiver chips must carry to route at all. Measured
 * 2026-11-05: sent bare from the dashboard, all twelve came back as a prose
 * "which job?" with no card; with a job added, the PO chips still did
 * until they named a vendor, and "the last pay app" read pay app status
 * first. Not wrong, but a dead-end-looking first tap.
 * On a job's own page the route's page context supplies the job and Send
 * works as filled. The eval cases add " on Riverside" for the same reason.
 */
export const WORKFLOW_EXAMPLES = [
  {
    workflow: "Change orders",
    examples: [
      { say: "Start a change order for extra door frames", command: "start_change_order" },
      { say: "Open a CO for the added soffit at the lobby", command: "start_change_order" },
    ],
  },
  {
    workflow: "Purchase orders",
    examples: [
      { say: "Make a PO to ABC Supply for 200 sheets of 5/8 type X", command: "draft_purchase_order" },
      { say: "Order 40 boxes of screws from L&W", command: "draft_purchase_order" },
    ],
  },
  {
    workflow: "Pay apps & retainage",
    examples: [
      { say: "Bill this month's pay application", command: "start_pay_application" },
      { say: "Bill the retainage", command: "bill_retainage" },
    ],
  },
  {
    workflow: "Lien waivers",
    examples: [
      { say: "Prepare the lien waiver for pay app 4", command: "prepare_lien_waiver" },
      { say: "The GC wants a conditional waiver for pay app 3", command: "prepare_lien_waiver" },
    ],
  },
  {
    workflow: "Takeoff",
    examples: [
      { say: "Run takeoff on the drawings", command: "run_takeoff" },
      { say: "Find the walls on every floor plan", command: "run_takeoff" },
    ],
  },
  {
    workflow: "Estimate",
    examples: [
      { say: "Update the estimate from the takeoff", command: "post_takeoff_to_estimate" },
      { say: "Draft the line items from the scope", command: "draft_estimate_lines" },
    ],
  },
] as const satisfies readonly {
  workflow: string;
  examples: readonly { say: string; command: CommandName }[];
}[];
