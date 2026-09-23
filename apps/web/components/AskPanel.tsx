"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { usePathname } from "next/navigation";
import { boundTurns, type AskTurn } from "@/lib/ask/turns";
import {
  answeredAgo,
  boundTranscript,
  staleIndices,
  stalenessNote,
  summarizeQuestion,
  type TranscriptEntry,
} from "@/lib/ask/transcript";
import { EXAMPLES } from "@/components/askExamples";
import { ASK_PREFILL_EVENT, takePendingAsk } from "@/lib/empty-state-events";
import type { AskRequest, AskStreamEvent, ClarifyView, ProposalView } from "@/lib/ask/answer";
import type { Citation, ItemLink } from "@/lib/ask/tools";
import {
  cancelAskProposal,
  confirmAskProposal,
  loadAskProposal,
  prepareAskAttachment,
  recordIntakeDocument,
} from "@/lib/actions";
import { upload } from "@vercel/blob/client";
import { intakeUploadErrorMessage } from "@/lib/intake/upload";
import {
  ASK_ATTACHMENT_ACCEPT,
  askAttachmentTypeOrSizeProblem,
  type AskAttachmentRef,
} from "@/lib/ask/attachment";
import { AskProposalCard, type ProposalOutcome } from "@/components/AskProposalCard";
import {
  DICTATION_TRUNCATED_NOTE,
  finalTranscript,
  mergeDictation,
  speechRecognitionFrom,
  type SpeechRecognitionLike,
} from "@/components/speechInput";

/** The ask box on the dashboard.
 *
 * It is SHAPED like a chat now — history above, input pinned below it — and
 * this header has claimed "deliberately not a chat" through two commits that
 * made it more of one. The claim was never about the layout. It is about
 * what is remembered: the assistant carries the CONVERSATION and never the
 * FACTS, which is the line below and the only one worth defending. The
 * layout is just where a person's hand already is.
 *
 * This header also used to end "Nothing here remembers a previous question",
 * and that is no longer true, so it is amended rather than left to go
 * quietly false.
 *
 * The original reason stands and is the reason the change took the shape it
 * did: "a scrollback of stale answers is a place for a number to be read
 * long after it stopped being true." A dollar figure from four minutes ago
 * is not a fact about now, and a panel that leaves it on screen invites
 * somebody to read it as one.
 *
 * So: the assistant remembers the CONVERSATION and never the FACTS. The last
 * few questions and answers travel with the next question so it can resolve
 * "the same", "that job", "it" — the things a person says to a colleague who
 * was listening. Every figure in the new answer still comes from a fresh
 * tool call, because the standing rule did not move. **A stale number cannot
 * survive into a new answer, not because it is filtered but because nothing
 * quotes it** — see lib/ask/turns.ts.
 *
 * A SCROLLBACK IS NOW RENDERED, and this paragraph said the opposite — "no
 * scrollback is rendered, old answers are not redisplayed" — for the whole
 * life of the commit that added one. Corrected rather than deleted, because
 * the shape is the lesson this repo keeps paying for: a sentence describing
 * what the code does NOT do goes stale the moment somebody builds it, and it
 * reads as a decision to anyone who gets this far.
 *
 * What the scrollback looks like is the answer to the objection above.
 * Every row is CLOSED, showing the question the person typed, when it was
 * answered and which pages it read — and no figure at all. A tap opens one,
 * and an opened row that is not the newest carries the mark. So a stale
 * number is never merely on screen: somebody chose to look at it, and the
 * sentence saying when it was read is next to it when they do.
 *
 * It can also DO things as well as answer, and that did not make it a chat
 * either. A command ends the stream with a card or a row of chips; the card
 * is one tap to confirm or cancel, the chips re-run the same question with
 * the pick. "Ask something else" ends the sitting — it clears the result AND
 * what was remembered, which is what its name has always promised.
 */

/** Shown until someone types. Each one is a question this app can actually
 * answer — an example that returns "I don't have that" teaches people the
 * feature does not work.
 *
 * And none of them names a specific job. One did, and the job did not
 * exist in the data: a chip that asks about a job you do not have is the
 * same broken promise, dressed as a worked example. */
/** Where a pending card's id lives while a phone browser is backgrounded.
 * sessionStorage, not localStorage: it dies with the tab, and a card is
 * not a standing instruction. Every access is wrapped, since storage can
 * throw in a private window and the panel must still render. */
const PENDING_CARD_KEY = "askProposalId";

function rememberCard(id: string | null) {
  try {
    if (id) sessionStorage.setItem(PENDING_CARD_KEY, id);
    else sessionStorage.removeItem(PENDING_CARD_KEY);
  } catch {
    // No storage, no reattach; nothing else changes.
  }
}

/** What was said earlier in this sitting.
 *
 * sessionStorage for the same reason the pending card uses it: it dies with
 * the tab. A jobsite tablet passed between two people must not carry one
 * person's questions into the next person's session, and a conversation is
 * even less of a standing instruction than a card is.
 *
 * Nothing is stored server-side. The turns travel with the request and the
 * server bounds them (lib/ask/turns.ts) — memory carries the conversation,
 * never the facts, so there is nothing here worth persisting beyond the tab.
 */
/** The scrollback a person reads. A SECOND key beside askTurns on purpose:
 * that one is the wire format and every byte of it is prompt weight paid on
 * every question, while this never leaves the browser and holds what the
 * screen needs — when it was asked, what it cited. See lib/ask/transcript.ts
 * for the argument. sessionStorage for the same reason the card id is:
 * a conversation dies with the tab. */
const TRANSCRIPT_KEY = "askTranscript";

function rememberTranscript(entries: TranscriptEntry[]) {
  try {
    if (entries.length) sessionStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(entries));
    else sessionStorage.removeItem(TRANSCRIPT_KEY);
  } catch {
    // Private window, blocked storage. The panel renders without a
    // scrollback rather than not rendering.
  }
}

function rememberedTranscript(): TranscriptEntry[] {
  try {
    const raw = sessionStorage.getItem(TRANSCRIPT_KEY);
    return raw ? boundTranscript(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

const TURNS_KEY = "askTurns";

function rememberTurns(turns: AskTurn[]) {
  try {
    if (turns.length) sessionStorage.setItem(TURNS_KEY, JSON.stringify(turns));
    else sessionStorage.removeItem(TURNS_KEY);
  } catch {
    // No storage, no memory. Every question still answers on its own,
    // which is exactly how this panel behaved before.
  }
}

function rememberedTurns(): AskTurn[] {
  try {
    const raw = sessionStorage.getItem(TURNS_KEY);
    return raw ? boundTurns(JSON.parse(raw)) : [];
  } catch {
    // Unparseable or unavailable. Same answer either way.
    return [];
  }
}

function rememberedCard(): string | null {
  try {
    return sessionStorage.getItem(PENDING_CARD_KEY);
  } catch {
    return null;
  }
}

/** A file on its way into, or sitting in, the box. `ready` carries the
 * reference the question will send; nothing else about it leaves the tab. */
type PendingAttachment =
  | { status: "uploading"; name: string }
  | { status: "ready"; name: string; ref: AskAttachmentRef };

// EXAMPLES moved to components/askExamples.ts — a constant exported from
// a "use client" module crosses the RSC boundary as a client-reference
// proxy, which is the Hint.tsx scar in CLAUDE.md.

/**
 * "Go straight to" — one control per record the answer named.
 *
 * A LINK, not a button, and styled as a control: it navigates, so it must
 * middle-click, open in a new tab and be read as a link by a screen
 * reader. `min-h-11` because this is the thing a foreman taps on a phone,
 * and the app's own touch target elsewhere is 44px (AskProposalCard).
 *
 * The label and detail are the RECORD'S OWN WORDS, handed over by the
 * handler — the model never writes an href and never edits one, which is
 * why a button here cannot point at something that does not exist. See
 * `ItemLink` in lib/ask/tools.ts.
 */
function ItemLinks({ links }: { links: ItemLink[] }) {
  return (
    <div className="mt-3" data-ask="item-links">
      <p className="text-xs text-ink-body">Go straight to</p>
      <ul className="mt-1 flex flex-col gap-1">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="flex min-h-11 flex-col justify-center rounded-md border border-line-card px-3 py-2 hover:border-link"
            >
              <span className="text-sm font-medium text-ink">{link.label}</span>
              {link.detail && (
                <span className="text-xs text-ink-body">{link.detail}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AskPanel() {
  // The route the person is looking at, sent with every question so the
  // assistant does not have to ask which job they mean when they are
  // standing on it. See lib/ask/page-context.ts — it is a hint the server
  // resolves through the session's own company, never an authority.
  const pathname = usePathname();
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [links, setLinks] = useState<ItemLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Text streamed before any tool has run is the model talking to itself
  // ("I'll pull the areas that could change your day") and is discarded
  // when results arrive. It goes in the STATUS slot, never the answer
  // slot.
  //
  // The first attempt at this kept it in the answer element and only
  // restyled it. That was wrong twice over: the restyle was invisible to a
  // reader who had already seen a sentence appear where answers appear,
  // and it was invisible to measurement too, since `text-ink-body`
  // contains `text-ink` as a substring and the element is identified by
  // `whitespace-pre-line` either way. Now the answer element simply does
  // not exist until there is an answer, which nothing can misread.
  const [progress, setProgress] = useState("");
  // Refs, not state: `apply` needs to read these synchronously while
  // handling a stream event, and a state updater must stay pure — doing
  // the read by calling setState with a side effect inside would
  // double-append under React's double-invoked updaters.
  const provisionalRef = useRef(true);
  const progressRef = useRef("");
  // The answer text and the question it answered, readable at "done".
  // State updaters cannot be read synchronously and recording a turn from
  // inside one would run twice under StrictMode.
  const answerRef = useRef("");
  const askedRef = useRef("");
  const [isAsking, setIsAsking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // "Ask C Stream to do it" on an empty state (EmptyState.tsx): the sentence
  // lands in the box and waits. Never sent from here — the person reads it,
  // changes it if they like, and presses Ask. Taken on mount for the
  // launcher's panel, which does not exist until the click that opens it.
  useEffect(() => {
    const fill = (text: string) => {
      setQuestion(text);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    const pending = takePendingAsk();
    if (pending) fill(pending);
    const onPrefill = (event: Event) => {
      const text = (event as CustomEvent<unknown>).detail;
      if (typeof text === "string" && text !== "") {
        takePendingAsk();
        fill(text);
      }
    };
    window.addEventListener(ASK_PREFILL_EVENT, onPrefill);
    return () => window.removeEventListener(ASK_PREFILL_EVENT, onPrefill);
  }, []);
  const abortRef = useRef<AbortController | null>(null);

  // A command's card, a resolver's chips, and what a confirmed card became.
  // Only one of the first two exists at a time; both die on the next ask.
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [clarify, setClarify] = useState<ClarifyView | null>(null);
  const [outcome, setOutcome] = useState<ProposalOutcome | null>(null);
  const [tapError, setTapError] = useState<string | null>(null);
  // Web suggestions the person unticked on the card in front of them.
  const [droppedSuggestions, setDroppedSuggestions] = useState<string[]>([]);

  // THE ATTACHMENT. `attachment` is the chip in the box, before sending;
  // `sentAttachment` is the file the question on screen was asked with,
  // kept for its name and for "File it in Document intake". An upload is
  // tagged with a sequence number so a file removed mid-upload cannot
  // reappear when its upload finishes.
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [sentAttachment, setSentAttachment] = useState<AskAttachmentRef | null>(null);
  const [filed, setFiled] = useState<{ ok: boolean; message: string } | null>(null);
  const [isFiling, startFiling] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadSeq = useRef(0);
  const sentAttachmentRef = useRef<AskAttachmentRef | null>(null);

  // The scrollback, and the clock the staleness marks are measured against.
  // Both start empty and are filled in an effect: the server renders no
  // transcript and no timestamp, so there is nothing for hydration to
  // disagree about — the same rule this repo applies to every other date.
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [now, setNow] = useState(0);
  // Which rows are open, by the moment they were asked. Everything starts
  // CLOSED: a scrollback whose rows are all open is the old full-height
  // list with extra chrome, and the point of collapsing is that a sitting's
  // worth of questions fits on screen at once. `askedAt` rather than an
  // index because trimming at MAX_TRANSCRIPT shifts every index down one
  // and would silently open somebody else's row.
  const [openRows, setOpenRows] = useState<number[]>([]);
  const citationsRef = useRef<Citation[]>([]);
  const linksRef = useRef<ItemLink[]>([]);
  const scrollbackRef = useRef<HTMLDivElement>(null);

  // Open at the BOTTOM, which is where the newest prior exchange is. A
  // scrollback that opens at the top shows the oldest thing first and cuts
  // the one most likely to be wanted off below the fold — which is what the
  // first click test of this showed. Older is what you scroll UP for.
  useEffect(() => {
    const box = scrollbackRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [transcript]);

  useEffect(() => {
    setTranscript(rememberedTranscript());
    setNow(Date.now());
    // Ages are coarse ("3 hours ago"), so a minute is plenty — and without
    // it a panel left open all afternoon keeps claiming "just now".
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);
  const [isConfirming, startConfirm] = useTransition();

  // Dictation. `canDictate` starts false and is only ever set in an effect:
  // the server renders no mic, and the browser adds one if it has the API.
  // Reading `window` during render would differ between the two passes and
  // break hydration — the same rule this repo already applies to dates.
  const [canDictate, setCanDictate] = useState(false);
  const [listening, setListening] = useState(false);
  const [dictationNote, setDictationNote] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setCanDictate(speechRecognitionFrom(window) !== null);
  }, []);

  // Stop the microphone when this panel goes away. Without it the browser
  // keeps listening after a navigation — a live mic the person cannot see
  // is the one bug in this feature that is worse than it not working.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  function stopDictation() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }

  function toggleDictation() {
    if (listening) {
      stopDictation();
      return;
    }
    const Ctor = speechRecognitionFrom(window);
    if (!Ctor) return;

    const recognition = new Ctor();
    // `continuous` because this is for the long requests a person would not
    // type standing on a deck; `interimResults` so the recogniser settles a
    // phrase before it is final, while `finalTranscript` drops the interim
    // ones so the same words never land twice.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (event) => {
      const phrase = finalTranscript(event);
      if (phrase === "") return;
      setQuestion((current) => {
        const merged = mergeDictation(current, phrase);
        setDictationNote(merged.truncated ? DICTATION_TRUNCATED_NOTE : null);
        return merged.text;
      });
    };
    // The browser's own words are not shown. "no-speech" and "aborted" are
    // ordinary, and a denied mic is a permission the person can see in their
    // own browser chrome — so this stops rather than explaining.
    recognition.onerror = () => stopDictation();
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  // Asking something else, or leaving, must stop the request in flight —
  // otherwise a slow answer to an abandoned question arrives later and
  // overwrites the one being read.
  useEffect(() => () => abortRef.current?.abort(), []);

  // A card proposed before the tab went to the background comes back with
  // it. The server decides whether it is still this person's, unsettled
  // and unexpired; anything else and the id is simply forgotten.
  useEffect(() => {
    const id = rememberedCard();
    if (!id) return;
    startConfirm(async () => {
      const result = await loadAskProposal(id);
      if (result.ok) {
        setAsked(result.value.question);
        setProposal(result.value.proposal);
      } else {
        rememberCard(null);
      }
    });
    // Mount only: a reattach is a one-time read of what the tab remembered.
  }, []);

  function apply(event: AskStreamEvent) {
    switch (event.type) {
      case "tools":
        // The sentence is built on the server, which knows the registry;
        // this component must not import it, since it imports the database.
        setStatus(event.label);
        break;
      case "answering":
        // Tools are done; what streams from here is the answer itself, and
        // whatever the model said before that is discarded.
        provisionalRef.current = false;
        progressRef.current = "";
        setProgress("");
        break;
      case "reset":
        setAnswer("");
        progressRef.current = "";
        setProgress("");
        break;
      case "text":
        if (provisionalRef.current) {
          progressRef.current += event.delta;
          setProgress(progressRef.current);
        } else {
          answerRef.current += event.delta;
          setAnswer((current) => current + event.delta);
        }
        break;
      case "done":
        setCitations(event.citations);
        citationsRef.current = event.citations;
        setLinks(event.links);
        linksRef.current = event.links;
        setStatus(null);
        // An answer that called no tool at all — a refusal, a clarifying
        // question — never gets `answering`, so everything it said is
        // sitting in the progress slot. Move it across, or a refusal
        // renders as a status line that never resolves into an answer.
        if (provisionalRef.current && progressRef.current) {
          answerRef.current = progressRef.current;
          setAnswer(progressRef.current);
          progressRef.current = "";
          setProgress("");
        }
        provisionalRef.current = false;
        // The exchange, recorded now that the answer is whole. Questions and
        // answer TEXT only — no tool results, so nothing here can be quoted
        // as a fact later. See lib/ask/turns.ts.
        if (askedRef.current && answerRef.current.trim()) {
          rememberTurns(
            boundTurns([
              ...rememberedTurns(),
              { role: "user", content: askedRef.current },
              { role: "assistant", content: answerRef.current.trim() },
            ]),
          );
          // And the person's copy, which keeps what the model has no use
          // for: when it was asked, and the pages the figures came from.
          // The citations are the real remedy for a stale figure — not
          // hiding the number, but leaving the live one one tap away.
          const recorded = boundTranscript([
            ...rememberedTranscript(),
            {
              question: askedRef.current,
              answer: answerRef.current.trim(),
              citations: citationsRef.current,
              ...(linksRef.current.length ? { links: linksRef.current } : {}),
              askedAt: Date.now(),
              ...(sentAttachmentRef.current ? { attachmentName: sentAttachmentRef.current.name } : {}),
            },
          ]);
          rememberTranscript(recorded);
          setTranscript(recorded);
          setNow(Date.now());
        }
        break;
      case "proposal":
        // Terminal. Whatever the model was saying is not the answer; the
        // card is.
        setProposal(event.proposal);
        rememberCard(event.proposal.proposalId);
        setStatus(null);
        progressRef.current = "";
        setProgress("");
        break;
      case "clarify":
        setClarify(event.clarify);
        setStatus(null);
        progressRef.current = "";
        setProgress("");
        break;
      case "error":
        setAnswer("");
        progressRef.current = "";
        setProgress("");
        setError(event.error);
        setStatus(null);
        break;
    }
  }

  /** Clears everything a previous question produced. A pending card is
   * withdrawn on the server too, so it cannot be confirmed later from a
   * stale tab. */
  function clearResult() {
    if (proposal && !outcome) void cancelAskProposal(proposal.proposalId);
    rememberCard(null);
    setAnswer("");
    setCitations([]);
    citationsRef.current = [];
    setLinks([]);
    linksRef.current = [];
    setError(null);
    setProposal(null);
    setClarify(null);
    setOutcome(null);
    setTapError(null);
    setDroppedSuggestions([]);
    setFiled(null);
  }

  /** Clears the chip and forgets any upload still in flight. The blob, if
   * it landed, stays in the store like any intake file nobody filed. */
  function clearAttachment() {
    uploadSeq.current += 1;
    setAttachment(null);
    setAttachError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function attach(file: File) {
    setAttachError(null);
    const seq = ++uploadSeq.current;
    // The browser's copy of the rule, so a 40 MB drawing set is refused
    // before a byte moves. The server says the same sentence twice more.
    const problem = askAttachmentTypeOrSizeProblem(file.type, file.size);
    if (problem) {
      setAttachment(null);
      setAttachError(problem);
      return;
    }
    setAttachment({ status: "uploading", name: file.name });
    const prepared = await prepareAskAttachment(file.name, file.type, file.size);
    if (seq !== uploadSeq.current) return;
    if (!prepared.ok) {
      setAttachment(null);
      setAttachError(prepared.error);
      return;
    }
    try {
      // The intake route, unchanged: it signs a token for this company's
      // intake folder only. See app/api/intake/upload/route.ts.
      const blob = await upload(prepared.value.pathname, file, {
        access: "public",
        contentType: file.type,
        handleUploadUrl: "/api/intake/upload",
        clientPayload: JSON.stringify({ contentType: file.type }),
      });
      if (seq !== uploadSeq.current) return;
      setAttachment({
        status: "ready",
        name: file.name,
        ref: { url: blob.url, name: file.name, contentType: file.type, size: file.size },
      });
    } catch (err) {
      if (seq !== uploadSeq.current) return;
      setAttachment(null);
      setAttachError(intakeUploadErrorMessage(err));
    }
  }

  /** The existing intake path, by the person's own tap: one row in the
   * tray, classified and waiting for them there like any dropped file. */
  function fileInIntake(ref: AskAttachmentRef) {
    startFiling(async () => {
      const formData = new FormData();
      formData.set("blobUrl", ref.url);
      formData.set("fileName", ref.name);
      formData.set("contentType", ref.contentType);
      formData.set("byteSize", String(ref.size));
      const result = await recordIntakeDocument(formData);
      setFiled(
        result.ok
          ? { ok: true, message: "Filed in Document intake — it's waiting in the tray for you to say what it is." }
          : { ok: false, message: result.error },
      );
    });
  }

  async function send(request: AskRequest, shown: string) {
    // Captured here rather than read off state at "done": `asked` is state
    // and the closure that handles the stream would see a stale one.
    askedRef.current = shown;
    answerRef.current = "";
    // A question already in flight is abandoned rather than blocking this
    // one. Previously the input stayed enabled while the button was
    // disabled, so pressing Return mid-answer did nothing at all — no new
    // question, no feedback. Waiting ten seconds to be allowed to ask
    // something else is not a feature.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    clearResult();
    setAsked(shown);
    // Deliberately not "Reading your records…". At this point nothing has
    // been read and nothing may be: a question this app cannot answer
    // spends its whole wait behind that sentence, which is then a false
    // claim for the entire time a person is looking at it. The `tools`
    // event says what is actually being read, once something is.
    setStatus("Thinking…");
    progressRef.current = "";
    setProgress("");
    provisionalRef.current = true;
    setIsAsking(true);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Where they are standing, sent with every question. Read here
        // rather than passed in as a prop, so all three mount points — the
        // Topbar launcher, the dashboard and /ask — get it with nothing to
        // keep in sync, which is the property AskLauncher's own comment is
        // about. A HINT only: the server resolves it through the session's
        // company and ignores anything that is not this company's job.
        body: JSON.stringify({ ...request, pagePath: pathname, priorTurns: rememberedTurns() }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        setError("The assistant is unavailable right now. Try again shortly.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // One JSON object per line. A chunk can split a line anywhere, so
        // the trailing fragment stays in the buffer until its newline
        // arrives — parsing it early would throw on valid output.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            apply(JSON.parse(line) as AskStreamEvent);
          } catch {
            // A malformed line is a bug on our side; dropping it beats
            // killing an answer that is otherwise arriving fine.
          }
        }
      }
    } catch (err) {
      // An abort is us, not a failure — the next question is already
      // running and owns the panel now.
      if ((err as { name?: string }).name !== "AbortError") {
        setError("The assistant is unavailable right now. Try again shortly.");
      }
    } finally {
      if (abortRef.current === controller) {
        setIsAsking(false);
        setStatus(null);
      }
    }
  }

  function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    // The chip goes with THIS question and then leaves the box: a file is
    // sent once, and the next question is about whatever it is about.
    const ref = attachment?.status === "ready" ? attachment.ref : null;
    sentAttachmentRef.current = ref;
    setSentAttachment(ref);
    if (ref) clearAttachment();
    void send(ref ? { question: trimmed, attachment: ref } : { question: trimmed }, trimmed);
  }

  /** A chip: the same question, with the person's pick, and no model pass. */
  function choose(current: ClarifyView, value: string) {
    void send(
      {
        question: asked,
        continuation: {
          command: current.command,
          partialInput: current.partialInput,
          answers: { [current.field]: value },
        },
      },
      asked,
    );
  }

  function confirm(current: ProposalView) {
    setTapError(null);
    startConfirm(async () => {
      const result = await confirmAskProposal(current.proposalId, droppedSuggestions);
      if (result.ok) {
        setOutcome(result.value);
        rememberCard(null);
      } else {
        setTapError(result.error);
      }
    });
  }

  function cancel(current: ProposalView) {
    startConfirm(async () => {
      await cancelAskProposal(current.proposalId);
      setProposal(null);
      setTapError(null);
      rememberCard(null);
    });
  }

  const hasResult =
    answer !== "" || error !== null || proposal !== null || clarify !== null || outcome !== null;

  /**
   * The scrollback shows what came BEFORE the answer on screen, never the
   * answer on screen.
   *
   * Without this the newest exchange renders twice — once in the box and
   * again in the live block below it — which is what the first click test
   * of this feature showed. Matching on the question rather than on a
   * count is what makes the two other cases right: after a reload there is
   * no live answer, so every entry belongs in the box; and while a NEW
   * question is in flight the last entry is the previous one, which also
   * belongs in the box.
   *
   * The index is carried through because staleness is a fact about a
   * position in the whole transcript, not in this filtered view.
   */
  const priorExchanges = transcript
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => !(hasResult && index === transcript.length - 1 && entry.question === asked));

  /**
   * A clean start: the live result, the remembered conversation the model
   * is sent, and the scrollback, together. "Ask something else" and the
   * scrollback's Clear both call this, because clearing only the rows would
   * leave the model remembering questions the screen says are gone.
   */
  function startOver() {
    abortRef.current?.abort();
    clearResult();
    // Something ELSE. The name has always promised a clean start, so the
    // remembered conversation goes with the result — otherwise "the same"
    // would reach back across a boundary the person drew deliberately.
    rememberTurns([]);
    // The scrollback goes with them. A transcript that survives is the
    // boundary the person drew being ignored on screen while it is
    // honoured in the prompt.
    rememberTranscript([]);
    setTranscript([]);
    setOpenRows([]);
    // The file goes with the conversation: Clear all leaves no chip and no
    // name behind.
    clearAttachment();
    sentAttachmentRef.current = null;
    setSentAttachment(null);
    askedRef.current = "";
    answerRef.current = "";
    setAsked("");
    setQuestion("");
    inputRef.current?.focus();
  }

  function toggleRow(askedAt: number) {
    setOpenRows((current) =>
      current.includes(askedAt) ? current.filter((value) => value !== askedAt) : [...current, askedAt],
    );
  }

  return (
    <section className="rounded-lg border border-line-card bg-surface p-4">
      {/* THE SCROLLBACK, ABOVE THE BOX.
          It sat BELOW the input until now, which put the conversation in
          the wrong reading order — you typed at the top and the history
          grew underneath, so the newest exchange was furthest from the
          thing you were about to type into. Above the box, oldest at the
          top, newest nearest the input, is how every chat a person has
          ever used is laid out, and it means the input stays where the
          hand already is as the sitting grows.

          Rows are COLLAPSED to the question. What opens a row is a tap;
          what a closed row shows is the person's own words, when it was
          answered, and which pages it read — see summarizeQuestion in
          lib/ask/transcript.ts for why it is never a slice of the answer.

          Capped in height and scrolled on its own, because this panel sits
          above the rest of the dashboard and must not push it down the
          page as a conversation grows. */}
      {priorExchanges.length > 0 && (
        <div className="mb-1 flex justify-end" data-ask="transcript-clear">
          {/* The shared two-step delete, so the arming state and the
              Cancel-on-the-vacated-pixel rule are the ones every list
              here uses. The label stays short for that rule's sake; what
              it clears is in `describe`. */}
          <ConfirmDeleteButton
            action={startOver}
            label="Clear all"
            confirmLabel="Clear them"
            describe="Clears these questions from this tab, and the assistant forgets them too."
          />
        </div>
      )}
      {priorExchanges.length > 0 && (
        <div
          ref={scrollbackRef}
          className="mb-3 max-h-80 overflow-y-auto rounded-md border border-line-row"
          data-ask="transcript"
        >
          <ol className="divide-y divide-line-row">
            {priorExchanges.map(({ entry, index }) => {
              const stale = staleIndices(transcript).includes(index);
              const open = openRows.includes(entry.askedAt);
              const rowId = `ask-entry-${entry.askedAt}-${index}`;
              return (
                <li key={rowId}>
                  <button
                    type="button"
                    onClick={() => toggleRow(entry.askedAt)}
                    aria-expanded={open}
                    aria-controls={rowId}
                    data-ask="transcript-row"
                    className="flex w-full min-h-11 items-start gap-2 px-3 py-2 text-left hover:bg-rail-hover"
                  >
                    <span aria-hidden="true" className="mt-0.5 shrink-0 text-xs text-ink-muted">
                      {open ? "▾" : "▸"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink-body">{summarizeQuestion(entry.question)}</span>
                      {/* The age and the pages, and no figure of any kind.
                          Nothing on a closed row can be read as a current
                          number, which is why the staleness note lives
                          inside: the mark travels with the figures it is
                          about. */}
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {answeredAgo(entry.askedAt, now)}
                        {entry.attachmentName && ` · Attached: ${entry.attachmentName}`}
                        {entry.citations.length > 0 &&
                          ` · ${entry.citations.map((citation) => citation.label).join(", ")}`}
                      </span>
                    </span>
                  </button>

                  {open && (
                    <div id={rowId} className="px-3 pb-3 pl-8" data-ask="transcript-open">
                      {/* The question again, in full — the row above it is
                          cut, and a person opening a row is often opening
                          it to find out which question it was. */}
                      <p className="text-sm font-medium text-ink-label">{entry.question}</p>
                      {entry.answer ? (
                        <p className={`mt-2 max-w-prose whitespace-pre-line text-base leading-relaxed ${stale ? "text-ink-muted" : "text-ink"}`}>
                          {entry.answer}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-ink-muted">Nothing came back for this one.</p>
                      )}
                      {entry.links && entry.links.length > 0 && (
                        <ItemLinks links={entry.links} />
                      )}
                      {entry.citations.length > 0 && (
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-body">
                          <span>Read from</span>
                          {entry.citations.map((citation) => (
                            <Link key={citation.href} href={citation.href} className="underline hover:text-link">
                              {citation.label}
                            </Link>
                          ))}
                        </p>
                      )}
                      {stale && (
                        <p className="mt-1 text-xs text-tag-amber-ink">
                          {stalenessNote(entry.askedAt, now)}{" "}
                          <button
                            type="button"
                            onClick={() => {
                              setQuestion(entry.question);
                              ask(entry.question);
                            }}
                            className="underline hover:text-link"
                          >
                            Ask again
                          </button>
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* The live exchange, between the history and the box — newest
          nearest the input, same as the scrollback's own ordering. */}
      {(hasResult || isAsking) && (
        <div className="mb-3">
          <p className="text-sm font-medium text-ink-label">{asked}</p>
          {sentAttachment && (
            <p className="mt-0.5 text-xs text-ink-body" data-ask="sent-attachment">
              Attached: {sentAttachment.name}
            </p>
          )}

          {/* The status line names what is being read, because a question
              spanning several areas spends most of its time in the
              database and a static message for eight seconds reads as a
              hang rather than as work. */}
          {(status || progress) && (
            <p
              className="mt-2 whitespace-pre-line text-base leading-relaxed text-ink-body"
              data-ask="progress"
              aria-live="polite"
            >
              {progress || status}
            </p>
          )}

          {/* whitespace-pre-line so a list the model writes as lines
              renders as lines. Nothing here is markdown: the answer is
              prose, and giving it a path to markup would be a hole.
              aria-live is polite so a screen reader is not interrupted on
              every token. */}
          {/* Only ever the answer. data-ask makes that checkable from a
              test without depending on Tailwind class names, one of which
              is a prefix of the other. */}
          {answer && (
            <p
              // 16px with relaxed leading and a readable line length.
              // It was 14px with the default tight leading, which was the
              // first thing said in a live demo: answers are the point of
              // this panel and they were set like a caption.
              className="mt-2 max-w-prose whitespace-pre-line text-base leading-relaxed text-ink"
              data-ask="answer"
              aria-live="polite"
            >
              {answer}
            </p>
          )}

          {error && (
            <p className="mt-1 text-sm text-tag-rose-ink" aria-live="polite">
              {error}
            </p>
          )}

          {/* A name matched several rows. The chips carry the detail that
              tells them apart, and a tap re-runs the same question with
              the pick — no retyping, no model pass. */}
          {clarify && (
            <div className="mt-2" data-ask="clarify">
              <p className="text-sm text-ink">{clarify.question}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {clarify.options.map((option) => (
                  <li key={option.value}>
                    <button
                      type="button"
                      disabled={isAsking}
                      onClick={() => choose(clarify, option.value)}
                      className="inline-flex min-h-11 flex-col items-start rounded-md border border-line-card px-3 py-1.5 text-left hover:border-link disabled:opacity-50"
                    >
                      <span className="text-sm text-ink">{option.label}</span>
                      {option.detail && <span className="text-xs text-ink-body">{option.detail}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {proposal && (
            <AskProposalCard
              proposal={proposal}
              pending={isConfirming}
              error={tapError}
              outcome={outcome}
              onConfirm={() => confirm(proposal)}
              onCancel={() => cancel(proposal)}
              // Leaving for the page the card hands off to. The card is
              // forgotten here rather than cancelled: the page will load
              // it, and the server refuses to reattach an opened card.
              onOpen={() => rememberCard(null)}
              dropped={droppedSuggestions}
              onToggleSuggestion={(key) =>
                setDroppedSuggestions((current) =>
                  current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
                )
              }
            />
          )}

          {/* Filing the document is the tray's job, not a second store: the
              same recordIntakeDocument the drop zone calls, on a tap. */}
          {sentAttachment && !isAsking && answer && (
            <div className="mt-2 text-xs" data-ask="file-in-intake">
              {filed ? (
                <p className={filed.ok ? "text-ink-body" : "text-tag-rose-ink"}>
                  {filed.message}{" "}
                  {filed.ok && (
                    <Link href="/intake" className="underline hover:text-link">
                      Open the tray
                    </Link>
                  )}
                </p>
              ) : (
                <button
                  type="button"
                  disabled={isFiling}
                  onClick={() => fileInIntake(sentAttachment)}
                  className="underline hover:text-link disabled:opacity-50"
                >
                  {isFiling ? "Filing…" : "File it in Document intake"}
                </button>
              )}
            </div>
          )}

          {/* The specific records the answer named, each a tap from being
              dealt with. ABOVE the citations deliberately: "go and fix
              this one" is the next thing a person wants, and "where this
              came from" is the thing they want when they doubt it. An
              answer with nothing row-shaped behind it carries none. */}
          {links.length > 0 && <ItemLinks links={links} />}

          {/* Citations arrive with the last event, not the first, so they
              appear once the answer is complete. An answer with no tool
              behind it carries none — links under a refusal would imply a
              sourcing that did not happen. */}
          {citations.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-body">
              <span>Read from</span>
              {citations.map((citation) => (
                <Link
                  key={citation.href}
                  href={citation.href}
                  className="underline hover:text-link"
                >
                  {citation.label}
                </Link>
              ))}
            </p>
          )}

          {!isAsking && hasResult && (
            <button
              type="button"
              onClick={startOver}
              className="mt-2 text-xs text-ink-body underline hover:text-link"
            >
              Ask something else
            </button>
          )}
        </div>
      )}

      {!hasResult && !isAsking && (
        <ul className="mb-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(example);
                  inputRef.current?.focus();
                  ask(example);
                }}
                className="rounded-full border border-line-card px-3 py-1 text-xs text-ink-body hover:border-link hover:text-link"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The attached file, as a chip, before it is sent. Removable until
          then; it leaves with the question it was sent with. */}
      {(attachment || attachError) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs" data-ask="attachment">
          {attachment && (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-line-card px-3 py-1 text-ink-body">
              <span className="truncate">{attachment.name}</span>
              {attachment.status === "uploading" && <span className="text-ink-muted">uploading…</span>}
              <button
                type="button"
                onClick={clearAttachment}
                aria-label={`Take ${attachment.name} off this question`}
                title="Take the file off"
                className="-mr-1 inline-flex h-6 w-6 items-center justify-center rounded-full hover:text-link"
              >
                ×
              </button>
            </span>
          )}
          {attachError && (
            <span role="status" className="text-tag-rose-ink">
              {attachError}
            </span>
          )}
        </div>
      )}

      {/* The box, LAST — the one fixed thing in the panel, with everything
          the sitting has produced stacked above it. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          // Sending ends the dictation. Leaving the mic live across a submit
          // drops the next sentence into a box that is about to be cleared.
          stopDictation();
          setDictationNote(null);
          ask(question);
          // Clear the box on send. Harmless while this was one question at
          // a time — you could edit and re-ask — and a real defect now that
          // it is a conversation: a follow-up typed into a box still
          // holding the last question APPENDS to it, and the person sends
          // "which invoices are overdue?raise an RFI on that job". Found on
          // the first two-question click test.
          setQuestion("");
        }}
        className="flex gap-2"
        data-tour="ask-box"
      >
        <input
          ref={inputRef}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about your jobs, money, drawings, crews — or start an estimate…"
          aria-label="Ask about your jobs"
          maxLength={1000}
          className="min-w-0 flex-1 rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none"
        />
        {/* Attach a file. The input is hidden and the button opens it; the
            upload starts on pick, so sending is not held up by it. */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ASK_ATTACHMENT_ACCEPT}
          className="hidden"
          data-ask="attach-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void attach(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach a file"
          title="Attach a PDF, photo or text file"
          className="shrink-0 rounded-md border border-line-card bg-surface px-3 py-2 text-ink-body hover:text-ink"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
            <path
              d="M13.5 6.5 7.8 12.2a1.5 1.5 0 0 0 2.1 2.1l6-6a3 3 0 0 0-4.2-4.2l-6.2 6.2a4.5 4.5 0 0 0 6.4 6.4l5-5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {/* Rendered only where the browser has the API. A mic that is on
            screen and does nothing reads as broken, not as unavailable —
            so Firefox gets no button rather than a dead one. */}
        {canDictate && (
          <button
            type="button"
            onClick={toggleDictation}
            aria-pressed={listening}
            aria-label={listening ? "Stop dictating" : "Dictate your question"}
            title={listening ? "Stop dictating" : "Dictate your question"}
            className={`shrink-0 rounded-md border px-3 py-2 ${
              listening
                ? "border-brand bg-brand/10 text-brand"
                : "border-line-card bg-surface text-ink-body hover:text-ink"
            }`}
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
              <path
                d="M10 3.5a2 2 0 0 1 2 2v4a2 2 0 1 1-4 0v-4a2 2 0 0 1 2-2Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5.5 9.5a4.5 4.5 0 0 0 9 0M10 14v2.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <button
          type="submit"
          // Disabled while in flight. Every create button in this app got
          // this treatment after a failed page invited a second click; this
          // one writes nothing, so a repeat is only a wasted call — but a
          // button that looks live during a slow answer invites the click
          // that makes it slower.
          // Was `isAsking && question.trim() === asked`, which read the box
          // to decide whether ITS OWN question was in flight. Clearing the
          // box on send makes that comparison always false, so it asks
          // `isAsking` directly — which is what it meant.
          disabled={question.trim() === "" || isAsking || attachment?.status === "uploading"}
          className="shrink-0 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isAsking ? "Looking…" : "Ask"}
        </button>
      </form>

      {/* Said out loud rather than shown only as a button colour: the person
          dictating is looking at the deck, not at the screen. The truncation
          note outlives the listening state on purpose — it is still true
          after the mic stops, and it is the one thing they must act on. */}
      {listening && (
        <p role="status" className="mt-2 text-xs text-ink-body">
          Listening — say it, then tap the mic again.
        </p>
      )}
      {dictationNote && (
        <p role="status" className="mt-2 text-xs font-medium text-tag-amber-ink">
          {dictationNote}
        </p>
      )}
    </section>
  );
}
