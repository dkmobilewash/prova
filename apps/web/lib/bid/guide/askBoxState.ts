import type { AskStreamEvent, ClarifyView, ProposalView } from "@/lib/ask/answer";
import type { Citation } from "@/lib/ask/tools";

/**
 * What the Bid job box shows for one question, as a pure function of the
 * events `/api/ask` streams — the same events, read by the same rules, as
 * `components/AskPanel.tsx`'s `apply`:
 *
 *   - text that streams before any tool has run is the model talking to itself
 *     ("let me check the estimate…"). It goes in the STATUS slot, and is
 *     discarded when `answering` arrives — unless the answer never gets one (a
 *     refusal, a clarifying question), in which case `done` moves it across so
 *     it is not left as a status that never resolves;
 *   - `reset` clears the answer, which is how the number-provenance guard
 *     RETRACTS one (lib/ask/answer.ts), and `error` clears it too;
 *   - `proposal` and `clarify` are terminal: the card or the chips are the
 *     answer, and whatever the model was saying is not.
 *
 * Lifted out as a reducer rather than copied as a second `apply` with its own
 * refs: the box has no transcript, no sessionStorage and no attachment, so the
 * panel's function would not fit, but the RULES must match — and a reducer can
 * be driven event by event in a test, which a component's refs cannot.
 */

export type AskBoxEvent = AskStreamEvent | { type: "thread"; threadId: string; title: string };

export type AskBoxState = {
  /** The question on screen. */
  asked: string;
  /** "Thinking…", or what is being read. */
  status: string | null;
  /** Provisional text: the model's preamble, shown as status. */
  progress: string;
  /** True until `answering` (or a terminal event): text is still preamble. */
  provisional: boolean;
  answer: string;
  error: string | null;
  citations: Citation[];
  proposal: ProposalView | null;
  clarify: ClarifyView | null;
  /** The stored thread this sitting is in, so a follow-up keeps its context. */
  threadId: string | null;
};

export const EMPTY_ASK_BOX: AskBoxState = {
  asked: "",
  status: null,
  progress: "",
  provisional: true,
  answer: "",
  error: null,
  citations: [],
  proposal: null,
  clarify: null,
  threadId: null,
};

/** A new question: the last result goes, the thread stays. */
export function startQuestion(state: AskBoxState, asked: string): AskBoxState {
  return { ...EMPTY_ASK_BOX, threadId: state.threadId, asked, status: "Thinking…" };
}

export function applyAskEvent(state: AskBoxState, event: AskBoxEvent): AskBoxState {
  switch (event.type) {
    case "thread":
      return { ...state, threadId: event.threadId };
    case "tools":
      return { ...state, status: event.label };
    case "answering":
      return { ...state, provisional: false, progress: "" };
    case "reset":
      return { ...state, answer: "", progress: "" };
    case "text":
      return state.provisional
        ? { ...state, progress: state.progress + event.delta }
        : { ...state, answer: state.answer + event.delta };
    case "done": {
      const moved = state.provisional && state.progress ? state.progress : null;
      return {
        ...state,
        citations: event.citations,
        status: null,
        provisional: false,
        answer: moved ?? state.answer,
        progress: moved ? "" : state.progress,
      };
    }
    case "proposal":
      return { ...state, proposal: event.proposal, status: null, progress: "" };
    case "clarify":
      return { ...state, clarify: event.clarify, status: null, progress: "" };
    case "error":
      return { ...state, answer: "", progress: "", error: event.error, status: null };
    default:
      return state;
  }
}

/** Whether there is anything under the box yet. */
export function hasResult(state: AskBoxState): boolean {
  return state.answer !== "" || state.error !== null || state.proposal !== null || state.clarify !== null;
}
