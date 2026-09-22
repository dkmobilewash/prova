/**
 * The Ask demo's script, held against the product it claims to show.
 *
 * Three families of assertion, each with a reason to exist:
 *
 *   1. REGISTRY. Every command the scene performs, and every command the
 *      can-do list stands for, is registered in lib/ask/commands.ts under
 *      that exact name, and the scene's headings, buttons and status lines
 *      are the registry's own `title`, `button` and `verb`. A rename or a
 *      removal fails the build here rather than leaving a promise on a
 *      public page. The card's handoff-or-direct shape is asserted too,
 *      because the scene's beats depend on it: the RFI shows a form and a
 *      save because `raise_rfi` is HANDOFF; the hours show Working… and
 *      Done because `log_time_entry` is DIRECT. Convert either and this
 *      says which beat to rewrite.
 *
 *   2. TIMING. The schedule sums to about twenty seconds, plays the beats
 *      in the order the product plays them — words, then a status line,
 *      then a card, then a tap, and only THEN anything saved — and
 *      `frameAt` is a pure function of time that loops.
 *
 *   3. COPY. Nothing on the page says the assistant acts without a person:
 *      no "fully automated", "hands-free", "no data entry" or their
 *      cousins, anywhere in the script, the list or the rendered markup.
 *      And the example is labelled as one.
 *
 * Renders are server renders (renderToStaticMarkup), which is also the
 * proof the still frame needs no browser to exist.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COMMANDS, commandNamed, type CommandName } from "@/lib/ask/commands";
import { subjectFromQuestion } from "@/lib/ask/commands/rfis";
import { dayLabel } from "@/lib/ask/dates";
import { parseHours } from "@/lib/ask/numbers";
import { AskCanDo } from "./AskCanDo";
import { AskDemo } from "./AskDemo";
import {
  CAN_DO,
  EXAMPLE_CAPTION,
  GATE_LINE,
  HOURS,
  HOURS_OUTCOME,
  HOURS_PREVIEW,
  PRODUCT_COPY,
  RFI,
  RFI_PREVIEW,
  SHOWN_COMMANDS,
  STEPS,
  TOTAL_MS,
  finalFrame,
  frameAt,
  frameKey,
  sceneDescription,
  stepAt,
} from "./askDemoScript";

const registered = new Set<string>(COMMANDS.map((command) => command.name));

describe("the demo performs only commands that exist", () => {
  it("names two commands, both registered", () => {
    expect(SHOWN_COMMANDS.length).toBe(2);
    for (const name of SHOWN_COMMANDS) {
      expect(registered.has(name), `"${name}" is not a registered Ask command`).toBe(true);
    }
    expect(RFI.command).toBe(SHOWN_COMMANDS[0]);
    expect(HOURS.command).toBe(SHOWN_COMMANDS[1]);
  });

  it("uses the RFI command's own title, verb and button, and its HANDOFF shape", () => {
    const command = commandNamed(RFI.command);
    expect(RFI.title).toBe(command.title);
    expect(RFI.verb).toBe(command.verb);
    expect(RFI.button).toBe(command.button);
    // The scene shows the RFI form and its Save because the card hands
    // off. If this becomes DIRECT, the form beat is the thing to remove.
    expect(command.mode).toBe("HANDOFF");
  });

  it("uses the hours command's own title, verb and button, and its DIRECT shape", () => {
    const command = commandNamed(HOURS.command);
    expect(HOURS.title).toBe(command.title);
    expect(HOURS.verb).toBe(command.verb);
    expect(HOURS.button).toBe(command.button);
    // The scene shows Working… then Done on the card because the tap IS
    // the write. If this becomes HANDOFF, those beats are wrong.
    expect(command.mode).toBe("DIRECT");
  });

  it("every can-do line stands for at least one registered command, and covers the registry", () => {
    const covered = new Set<string>();
    for (const group of CAN_DO) {
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(item.commands.length, `"${item.text}" maps to no command`).toBeGreaterThan(0);
        for (const name of item.commands) {
          expect(registered.has(name), `"${item.text}" names "${name}", which is not registered`).toBe(true);
          covered.add(name);
        }
      }
    }
    // The other direction: a command nobody lists is a capability the page
    // is silent about. Listed here rather than derived, so adding a
    // command is a deliberate decision about the page too.
    const unlisted = [...registered].filter((name) => !covered.has(name));
    expect(unlisted, `registered commands the list does not mention: ${unlisted.join(", ")}`).toEqual([]);
  });
});

describe("the card shows the fields the real card shows, and nothing else", () => {
  it("RFI: Job, Subject, Question, Date sent — in resolveRaiseRfi's order", () => {
    expect(RFI_PREVIEW.map((line) => line.label)).toEqual(["Job", "Subject", "Question", "Date sent"]);
    expect(RFI_PREVIEW.find((line) => line.label === "Date sent")?.value).toBe(
      "set on the form — defaults to today; blank keeps it a draft",
    );
  });

  it("RFI: the subject is what subjectFromQuestion derives, so the warning is the true one", () => {
    expect(RFI.subject).toBe(subjectFromQuestion(RFI.question));
    expect(RFI.warning).toBe("Subject taken from the question. Change it on the form if it should read differently.");
  });

  it("hours: Job, Person, Date, Hours, Pay type — in resolveLogTimeEntry's order", () => {
    expect(HOURS_PREVIEW.map((line) => line.label)).toEqual(["Job", "Person", "Date", "Hours", "Pay type"]);
  });

  it("hours: the date line is dayLabel's, the hours line is parseHours's display, and the day is a Monday", () => {
    expect(HOURS.dateLine).toBe(`${dayLabel(HOURS.day)} — today, on your calendar`);
    expect(HOURS.hoursLine).toBe(parseHours("8")?.display);
    expect(HOURS.payTypeLine).toBe("straight time");
    expect(new Date(`${HOURS.day}T00:00:00.000Z`).getUTCDay()).toBe(1);
  });

  it("hours: the outcome is executeLogTimeEntry's sentence, word for word", () => {
    expect(HOURS_OUTCOME.message).toBe(`Logged 8 hours for ${HOURS.person} on ${HOURS.job}, ${HOURS.day}.`);
    expect(HOURS_OUTCOME.createdLabel).toBe(`${HOURS.person}, ${HOURS.day}`);
  });
});

describe("the schedule", () => {
  it("sums to about twenty seconds", () => {
    expect(TOTAL_MS).toBe(STEPS.reduce((sum, step) => sum + step.ms, 0));
    expect(TOTAL_MS).toBeGreaterThanOrEqual(18_000);
    expect(TOTAL_MS).toBeLessThanOrEqual(22_000);
  });

  it("has no zero-length step and keeps task 1 before task 2", () => {
    for (const step of STEPS) expect(step.ms, step.name).toBeGreaterThan(0);
    const firstTask2 = STEPS.findIndex((step) => step.task === 2);
    expect(firstTask2).toBeGreaterThan(0);
    expect(STEPS.slice(0, firstTask2).every((step) => step.task === 1)).toBe(true);
    expect(STEPS.slice(firstTask2).every((step) => step.task === 2)).toBe(true);
  });

  it("frameAt is pure, loops, and stepAt covers every millisecond", () => {
    expect(frameKey(frameAt(1234))).toBe(frameKey(frameAt(1234)));
    expect(frameKey(frameAt(TOTAL_MS + 5))).toBe(frameKey(frameAt(5)));
    expect(frameKey(frameAt(-5))).toBe(frameKey(frameAt(TOTAL_MS - 5)));
    let seen = 0;
    for (let t = 0; t < TOTAL_MS; t += 50) {
      const { step, elapsed } = stepAt(t);
      expect(elapsed).toBeGreaterThanOrEqual(0);
      expect(elapsed).toBeLessThan(step.ms);
      seen++;
    }
    expect(seen).toBe(Math.ceil(TOTAL_MS / 50));
  });
});

/** The first millisecond of a named step, for a task. */
function startOf(task: 1 | 2, name: string): number {
  let start = 0;
  for (const step of STEPS) {
    if (step.task === task && step.name === name) return start;
    start += step.ms;
  }
  throw new Error(`no step ${task}:${name}`);
}

describe("the order of the beats: nothing is saved before a tap", () => {
  it("types the RFI prompt character by character, then shows a status line, then the card", () => {
    const early = frameAt(startOf(1, "typing") + 3);
    expect(early.typed.length).toBeGreaterThanOrEqual(1);
    expect(early.typed.length).toBeLessThan(RFI.prompt.length);
    expect(RFI.prompt.startsWith(early.typed)).toBe(true);
    expect(early.card).toBe("none");
    expect(early.asked).toBeNull();

    const sent = frameAt(startOf(1, "thinking") + 1);
    expect(sent.typed).toBe("");
    expect(sent.asked).toBe(RFI.prompt);
    expect(sent.status).toBe(PRODUCT_COPY.thinking);
    expect(sent.card).toBe("none");

    expect(frameAt(startOf(1, "resolving") + 1).status).toBe(`${RFI.verb}…`);

    const card = frameAt(startOf(1, "card") + 1);
    expect(card.card).toBe("proposed");
    expect(card.status).toBeNull();
    expect(card.tap).toBe("none");
    expect(card.view).toBe("panel");
  });

  it("the RFI tap lands on the handoff button, opens the form, and the form's own save produces the draft", () => {
    expect(frameAt(startOf(1, "reach") + 1)).toMatchObject({ card: "proposed", tap: "primary" });
    expect(frameAt(startOf(1, "press") + 1)).toMatchObject({ card: "pressed", tap: "primary" });
    // Nothing is saved when the form opens: the sent date is blank and the
    // number does not exist yet.
    expect(frameAt(startOf(1, "form") + 1)).toMatchObject({ view: "form", form: "open", tap: "none" });
    expect(frameAt(startOf(1, "pressSave") + 1)).toMatchObject({ view: "form", form: "pressed", tap: "save" });
    expect(frameAt(startOf(1, "saving") + 1)).toMatchObject({ view: "form", form: "saving" });
    expect(frameAt(startOf(1, "saved") + 1)).toMatchObject({ view: "saved" });
    // And the saved row is after the save press, not before.
    expect(startOf(1, "saved")).toBeGreaterThan(startOf(1, "pressSave"));
  });

  it("the hours tap comes before Working…, which comes before Done", () => {
    expect(frameAt(startOf(2, "card") + 1)).toMatchObject({ task: 2, card: "proposed", tap: "none" });
    expect(frameAt(startOf(2, "press") + 1)).toMatchObject({ card: "pressed", tap: "primary" });
    expect(frameAt(startOf(2, "pending") + 1)).toMatchObject({ card: "pending", tap: "none" });
    expect(frameAt(startOf(2, "settled") + 1)).toMatchObject({ card: "settled" });
    expect(startOf(2, "press")).toBeLessThan(startOf(2, "pending"));
    expect(startOf(2, "pending")).toBeLessThan(startOf(2, "settled"));
    // At no instant of task 2 is the card settled before the press.
    for (let t = startOf(2, "idle"); t < startOf(2, "press"); t += 25) {
      expect(frameAt(t).card, `settled at ${t}ms, before the tap`).not.toBe("settled");
    }
  });

  it("the final frame is the settled hours card — a real frame of the scene", () => {
    const frame = finalFrame();
    expect(frame).toMatchObject({ task: 2, card: "settled", view: "panel", asked: HOURS.prompt });
    expect(frameKey(frame)).toBe(frameKey(frameAt(startOf(2, "settled") + 1)));
  });
});

/** Words this page must never use about the assistant. Bluntly matched,
 * with no notion of polarity, for the reason LandingPage.tsx gives: the
 * fix for a sentence that trips this is not to teach it negation, it is
 * for the page not to contain the words. */
const BANNED = /fully[- ]automated|hands[- ]free|no data entry|automatic(?:ally)?|autopilot|on its own|without (?:you|asking|a tap)|zero[- ]touch/i;

describe("the copy", () => {
  const demoHtml = renderToStaticMarkup(createElement(AskDemo));
  const listHtml = renderToStaticMarkup(createElement(AskCanDo));
  const everything = [
    demoHtml,
    listHtml,
    sceneDescription(),
    EXAMPLE_CAPTION,
    GATE_LINE,
    RFI.prompt,
    HOURS.prompt,
    ...CAN_DO.flatMap((group) => [group.group, ...group.items.map((item) => item.text)]),
  ].join("\n");

  it("never says the assistant acts without a person", () => {
    expect(everything).not.toMatch(BANNED);
    // The pattern is alive: it does catch the sentence it exists for.
    expect("hours logged automatically, hands-free").toMatch(BANNED);
  });

  it("labels the scene as an example, at rest, in the markup", () => {
    expect(EXAMPLE_CAPTION).toMatch(/^Example\./);
    expect(demoHtml).toContain("Example. Your jobs, your crew.");
    expect(demoHtml).toContain("Nothing is saved until you tap.");
  });

  it("says, under the list, that it shows the write first and a tap approves it", () => {
    expect(listHtml).toContain("It shows you what it&#x27;s about to do. You tap once to approve.");
    for (const group of ["Billing", "Field", "The GC", "Estimating"]) expect(listHtml).toContain(group);
  });

  it("server-renders the still frame with no browser: the hours card, settled, and the description for a screen reader", () => {
    expect(demoHtml).toContain('data-ask-demo-mode="static"');
    expect(demoHtml).not.toContain('data-ask-demo-mode="motion"');
    expect(demoHtml).toContain(PRODUCT_COPY.done);
    expect(demoHtml).toContain("Logged 8 hours for Luis Ortega on Northgate Clinic TI");
    expect(demoHtml).toContain('class="sr-only"');
    expect(demoHtml).toContain(RFI.button);
    // The stage is hidden from assistive technology; the sentence is not.
    expect(demoHtml).toMatch(/aria-hidden="true"[^>]*data-ask-demo="stage"/);
    // No pause button on a still: there is nothing to pause.
    expect(demoHtml).not.toContain('data-ask-demo="pause"');
  });

  it("puts a dark label on every brand fill, never white", () => {
    for (const html of [demoHtml, listHtml]) {
      for (const match of html.matchAll(/class="([^"]*\bbg-brand\b[^"]*)"/g)) {
        expect(match[1]).toContain("text-neutral-900");
        expect(match[1]).not.toContain("text-white");
      }
    }
    expect(demoHtml).toMatch(/bg-brand/);
  });
});

// A compile-time check that SHOWN_COMMANDS really is typed against the
// registry's union and not against `string`.
const _typed: readonly CommandName[] = SHOWN_COMMANDS;
void _typed;
