/**
 * Ask's replies, read aloud — the other half of `speechInput.ts`.
 *
 * The browser's own `speechSynthesis`: no dependency, no paid voice API, and
 * nothing leaves the device. What can be WRONG about it lives here as plain
 * functions, because the component around it is mostly wiring.
 *
 * WHY THE TEXT IS REWRITTEN BEFORE IT IS SPOKEN. Answers are markdown. A
 * synthesiser handed "| Job | Owed |\n|---|---|" reads out "vertical bar job
 * vertical bar", and a link reads its whole URL a letter at a time. So links
 * keep their words, tables and code are dropped (they are on screen), and the
 * punctuation that is only formatting goes.
 *
 * WHY THERE IS A CAP. A long answer read in full is a minute of a phone
 * talking at somebody on a deck. The first ~600 characters carry the answer;
 * the rest is said to be on screen, which is true and is the honest version
 * of stopping.
 */

export const SPEAK_CAP = 600;
export const SPEAK_REST_NOTE = "…the rest is on screen.";

/** Markdown to something worth hearing, capped at `cap` characters at a word
 * boundary. Empty string when nothing speakable is left. */
export function speakableText(markdown: string, cap = SPEAK_CAP): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ") // code blocks
    .split("\n")
    .filter((line) => !/^\s*\|/.test(line)) // table rows and their rules
    .join("\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links keep their words
    .replace(/https?:\/\/\S+/g, " ") // bare URLs
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "") // headings, quotes, list markers
    .replace(/^\s*([-*_]\s*){3,}$/gm, " ") // horizontal rules
    .replace(/[*_~`]+/g, "") // emphasis and inline code marks
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\s+/g, " ")
    .replace(/([.!?:;,])(\s*\.)+/g, "$1") // a line break after a sentence already has its stop
    .replace(/^[\s.]+/, "")
    .trim();

  if (text.length <= cap) return text;
  const cut = text.slice(0, cap);
  const atSpace = cut.lastIndexOf(" ");
  return `${(atSpace > 0 ? cut.slice(0, atSpace) : cut).replace(/[,;:\s]+$/, "")} ${SPEAK_REST_NOTE}`;
}

/** The synthesiser and utterance constructor this browser offers, or null —
 * in which case no speaker control renders, for the same reason the mic does
 * not render without recognition: a dead control reads as broken. */
export function speechSynthesisFrom(
  win: unknown,
): { synth: SpeechSynthesis; Utterance: typeof SpeechSynthesisUtterance } | null {
  if (typeof win !== "object" || win === null) return null;
  const w = win as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance };
  if (!w.speechSynthesis || typeof w.SpeechSynthesisUtterance !== "function") return null;
  return { synth: w.speechSynthesis, Utterance: w.SpeechSynthesisUtterance };
}

/** "Read replies aloud", remembered per browser. Off unless the person turned
 * it on. Storage can throw (private mode, blocked site data); that reads as
 * off and writes as nothing, never as a crash. */
export const READ_ALOUD_KEY = "askReadAloud";

export function readAloudPreference(): boolean {
  try {
    return window.localStorage.getItem(READ_ALOUD_KEY) === "on";
  } catch {
    return false;
  }
}

export function rememberReadAloud(on: boolean) {
  try {
    if (on) window.localStorage.setItem(READ_ALOUD_KEY, "on");
    else window.localStorage.removeItem(READ_ALOUD_KEY);
  } catch {
    /* not remembered; the toggle still works for this visit */
  }
}

/** Conversation mode gives up after this many turns in a row with nothing
 * heard, so a forgotten panel does not keep a microphone open all afternoon. */
export const CONVERSATION_SILENT_TURNS = 2;
