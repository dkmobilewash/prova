import { describe, expect, it } from "vitest";
import { CENSUS_GAPS, CENSUS_REFUSALS, TOP_QUESTIONS, TOTAL_QUESTIONS, type TopQuestion } from "./top-questions";
import { ACCOUNTING, ESTIMATOR, FIELD, OWNER } from "./cases";
import { KNOWN_GAPS, TOOLS, toolsFor, type ToolName } from "../tools";
import { COMMANDS, commandsFor, type CommandName } from "../commands";

/**
 * The census, checked without a model, in CI, on every push.
 *
 * What this suite can prove and what it cannot, stated up front because
 * the gap between them is where a check like this goes wrong: it proves
 * there is a CAPABILITY behind each question and that the person asking
 * can be offered it. It does NOT prove the model picks that capability —
 * that is `top-questions.eval.ts`, which needs a key and costs money, and
 * it is a different question with a different answer.
 *
 * The rule from CLAUDE.md this file is built around: "a check that DERIVES
 * its input has two failure modes, not one. It can get the answer wrong,
 * and it can get an empty question." So every count here is asserted
 * against a number a person had to type, never against the array that
 * would shrink with it.
 */

const GAPS = TOP_QUESTIONS.filter((q) => q.route.kind === "gap");
const REFUSALS = TOP_QUESTIONS.filter((q) => q.route.kind === "refused");
const ROUTED = TOP_QUESTIONS.filter((q) => q.route.kind !== "gap" && q.route.kind !== "refused");

/** Every tool or command a question claims, flattened. */
function claimed(q: TopQuestion): string[] {
  switch (q.route.kind) {
    case "tool":
      return [q.route.name];
    case "command":
      return [q.route.name];
    case "several":
      return q.route.names;
    case "gap":
      return q.route.nearest ? [q.route.nearest] : [];
    case "refused":
      return [];
  }
}

describe("the hundred questions", () => {
  it("is a HUNDRED, and the number is typed rather than counted", () => {
    // The number is declared in the module and asserted here. Counting the
    // array against itself would pass at any size, which is the failure
    // mode that makes a census worthless — nothing is ever missing from a
    // list you measured with itself.
    expect(TOTAL_QUESTIONS).toBe(100);
    expect(TOP_QUESTIONS).toHaveLength(TOTAL_QUESTIONS);
  });

  it("has unique ids and no question asked twice", () => {
    expect(new Set(TOP_QUESTIONS.map((q) => q.id)).size).toBe(TOP_QUESTIONS.length);
    // Normalised, so two entries cannot differ only by punctuation and
    // pad the count.
    const asked = TOP_QUESTIONS.map((q) => q.question.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim());
    expect(new Set(asked).size).toBe(TOP_QUESTIONS.length);
  });

  it("gives every single one a decision — there is no fourth state", () => {
    const kinds = new Set(TOP_QUESTIONS.map((q) => q.route.kind));
    for (const kind of kinds) expect(["tool", "command", "several", "gap", "refused"]).toContain(kind);
    expect(ROUTED.length + GAPS.length + REFUSALS.length).toBe(TOP_QUESTIONS.length);
  });
});

describe("every route names something that exists and is offered", () => {
  const toolNames = new Set<string>(TOOLS.map((t) => t.name));
  const commandNames = new Set<string>(COMMANDS.map((c) => c.name));

  it("names a real tool or command", () => {
    for (const q of TOP_QUESTIONS) {
      for (const name of claimed(q)) {
        expect(toolNames.has(name) || commandNames.has(name), `${q.id} → ${name}`).toBe(true);
      }
    }
  });

  it("names one the person ASKING can be offered", () => {
    // A question routed to a tool the asker's job function never sees is
    // impossible rather than hard, and would sit in the list reading as
    // covered. This is the assertion that catches a capability change:
    // narrow MANAGE_FIELD tomorrow and the foreman's questions fail here.
    for (const q of TOP_QUESTIONS) {
      if (q.route.kind === "tool" || q.route.kind === "several") {
        const offered = toolsFor(q.asker).map((t) => t.name);
        for (const name of claimed(q)) expect(offered, `${q.id} → ${name}`).toContain(name as ToolName);
      }
      if (q.route.kind === "command") {
        const offered = commandsFor(q.asker).map((c) => c.name);
        expect(offered, `${q.id} → ${q.route.name}`).toContain(q.route.name as CommandName);
      }
    }
  });

  it("asks more than one kind of person", () => {
    // A census asked entirely as the OWNER never exercises a gate, and the
    // owner is the one person who holds everything — so it would pass the
    // test above for free. Five roles ask here; each must actually appear.
    for (const who of [OWNER, FIELD, ESTIMATOR, ACCOUNTING]) {
      const mine = TOP_QUESTIONS.filter(
        (q) => q.asker.role === who.role && q.asker.jobFunction === who.jobFunction,
      );
      expect(mine.length, JSON.stringify(who)).toBeGreaterThanOrEqual(5);
    }
    const payroll = TOP_QUESTIONS.filter((q) => q.asker.jobFunction === "PAYROLL_COMPLIANCE");
    expect(payroll.length).toBeGreaterThanOrEqual(5);
  });
});

describe("the gaps, which are the point", () => {
  it("is exactly the number somebody typed", () => {
    // Without this a new gap just makes the list longer. Worse: a tool
    // retired out from under a question turns that question into a gap
    // silently, and the census goes on reporting the same shape. This
    // number changes in a diff a person reads, or the build fails.
    expect(GAPS).toHaveLength(CENSUS_GAPS);
    expect(REFUSALS).toHaveLength(CENSUS_REFUSALS);
    expect(ROUTED).toHaveLength(TOTAL_QUESTIONS - CENSUS_GAPS - CENSUS_REFUSALS);
  });

  it("never counts a deliberate REFUSAL as a gap", () => {
    // The distinction this file would otherwise lose. `add 5/8 type X to
    // our catalog at 14.20` is refused because a catalog entry carries a
    // typed price and that is a number the model would be supplying — a
    // decision somebody made and defended, sitting in the estimating
    // exclusion list. Counting it among the gaps would put a safety rule on
    // a list of things to go and fix.
    for (const q of REFUSALS) {
      if (q.route.kind !== "refused") throw new Error("unreachable");
      expect(q.route.why.length, q.id).toBeGreaterThan(120);
    }
    expect(GAPS.map((q) => q.id)).not.toContain("q-catalog-create");
  });

  it("says WHY, specifically enough to argue with", () => {
    for (const q of GAPS) {
      if (q.route.kind !== "gap") throw new Error("unreachable");
      // A one-word reason is a shrug. Every gap here names the model, the
      // page or the missing data, and what a wrong answer would cost.
      expect(q.route.why.length, q.id).toBeGreaterThan(120);
    }
  });

  it("IS ON THE LIST THE MODEL IS ACTUALLY TOLD ABOUT", () => {
    // The one assertion in this file that changes what the assistant does.
    // A gap recorded here and nowhere else changes nothing: KNOWN_GAPS in
    // tools.ts is injected into the system prompt (answer.ts), and it is
    // the only thing telling the model to refuse rather than reach for the
    // nearest tool. Two lists that describe the same holes WILL drift, and
    // the direction that costs something is a gap dropping off the prompt
    // while staying in the census — where it reads as handled.
    const topics = KNOWN_GAPS.map((gap) => gap.topic.toLowerCase());
    for (const q of GAPS) {
      if (q.route.kind !== "gap") throw new Error("unreachable");
      const fragment = q.route.refusalTopic.toLowerCase();
      expect(
        topics.some((topic) => topic.includes(fragment)),
        `${q.id}: no KNOWN_GAPS topic contains "${fragment}" — the model is not told to refuse this`,
      ).toBe(true);
    }
  });

  it("takes a CLOSED gap off the list the model is told to refuse", () => {
    // The other direction from the test above, and the one it cannot see.
    // That test checks every open gap IS on KNOWN_GAPS; nothing checked that
    // a gap closed by a new tool LEFT it. A stale entry is not harmless
    // clutter — the list is injected into the system prompt, so it tells the
    // model to refuse a question a tool now answers, and the census would
    // go on reading the question as routed and fine.
    //
    // Named by hand rather than derived: a closed gap has no refusalTopic
    // left to derive from. Add a row here when you close one.
    const closed = [{ id: "q-emr", tool: "experience_mod_rate", stale: ["experience modification", "mod rate"] }];
    const topics = KNOWN_GAPS.map((gap) => `${gap.topic} ${gap.why}`.toLowerCase());
    for (const { id, tool, stale } of closed) {
      const q = TOP_QUESTIONS.find((question) => question.id === id);
      expect(q?.route, id).toEqual({ kind: "tool", name: tool });
      for (const fragment of stale) {
        expect(
          topics.filter((topic) => topic.includes(fragment)),
          `${id}: KNOWN_GAPS still tells the model to refuse "${fragment}"`,
        ).toEqual([]);
      }
    }
  });

  it("names the tool that would answer it WRONGLY, where one exists", () => {
    // The failure mode of a gap is never silence — it is a near-miss
    // delivered in the same voice as a fact. `crew_assignments` answering
    // "who is on Riverside tomorrow" with a roster is the example: right
    // shape, wrong question, and a foreman cannot tell from the answer.
    const named = GAPS.filter((q) => q.route.kind === "gap" && q.route.nearest !== null);
    // A FLOOR THAT SCALES WITH THE SET, and this line is a scar. It was
    // `>= 6`, then `>= 4`, written as absolute numbers when there were
    // thirteen gaps and then eight. Three gaps closed on 2026-09-18 (EMR,
    // lien deadlines, the pre-bid pipeline) and only three remain, so the
    // absolute floor failed on a census that was right — a floor on a
    // shrinking set goes stale exactly as fast as the set shrinks. What it
    // guards is that people keep filling in `nearest`, which is a ratio.
    expect(named.length).toBeGreaterThanOrEqual(Math.ceil(GAPS.length / 2));
    for (const q of named) {
      if (q.route.kind !== "gap" || !q.route.nearest) continue;
      expect(TOOLS.map((t) => t.name), q.id).toContain(q.route.nearest);
    }
  });
});

describe("the questions are in a contractor's words", () => {
  it("never uses the registry's own vocabulary", () => {
    // A question phrased as "run certification_expiry" grades nothing: the
    // model is being handed the answer in the question. Same family as the
    // watcher in CLAUDE.md that fired on a needle already on the page.
    const vocabulary = [...TOOLS.map((t) => t.name), ...COMMANDS.map((c) => c.name)];
    for (const q of TOP_QUESTIONS) {
      const asked = q.question.toLowerCase();
      for (const word of vocabulary) {
        expect(asked, `${q.id} contains "${word}"`).not.toContain(word);
      }
      // THERE WAS A SECOND CHECK HERE ON THE SPACED FORM — "open submittals"
      // being a tool's name with the underscore taken out — and it is gone,
      // because it fired three times on questions that were right.
      //
      // `add_punch_items` spaced is "add punch items". `certified_payroll`
      // spaced is "certified payroll". `team_roster` spaced is "team
      // roster". Those are not the registry leaking into a question; they
      // are the English the tool was NAMED AFTER, and a tool named the way
      // people talk is the thing this codebase is trying to do. A rule that
      // fires on correct input is a rule that gets suppressed, and the
      // underscored form above is the unambiguous half anyway: nobody types
      // `certified_payroll` into the box.
    }
  });

  it("is a real sentence somebody would say", () => {
    for (const q of TOP_QUESTIONS) {
      expect(q.question.length, q.id).toBeGreaterThan(14);
      // And an upper bound. A census of paragraphs is not a census of
      // questions: nobody types 200 characters into the box on a phone,
      // and a long entry is usually three questions wearing one id.
      expect(q.question.length, q.id).toBeLessThanOrEqual(140);
      expect(q.question, q.id).toBe(q.question.trim());
      // There WAS a rule here requiring a lower-case first letter, on the
      // grounds that these are typed in a hurry. It failed on "Turner
      // released 18,400 of the Cedar Park retainage", where the capital is
      // a proper noun and the sentence is exactly right. A style rule that
      // fires on correct input is a rule that gets suppressed, so it is
      // gone rather than excepted.
    }
  });
});

describe("what the hundred reach, and what they do not", () => {
  /** Capabilities no question in the top hundred reaches. Declared, with a
   * reason each, for the same reason the gaps are: a built capability that
   * nobody's most-asked question touches is worth knowing about. It is not
   * automatically wrong — some of these are written from a screen and
   * reached by tapping rather than by asking. */
  const NOT_REACHED: Record<string, string> = {};

  it("reaches every tool and command, or says why not", () => {
    const reached = new Set(TOP_QUESTIONS.flatMap((q) => (q.route.kind === "gap" ? [] : claimed(q))));
    const missing: string[] = [];
    for (const name of [...TOOLS.map((t) => t.name), ...COMMANDS.map((c) => c.name)]) {
      if (!reached.has(name) && !(name in NOT_REACHED)) missing.push(name);
    }
    // Named in the failure rather than counted, so the message says which.
    expect(missing).toEqual([]);
  });

  it("does not excuse a capability that IS reached", () => {
    // The other direction, and the one that rots: an entry left in
    // NOT_REACHED after somebody wrote a question for it reads as a
    // standing gap that has already been closed.
    const reached = new Set(TOP_QUESTIONS.flatMap((q) => (q.route.kind === "gap" ? [] : claimed(q))));
    for (const name of Object.keys(NOT_REACHED)) expect(reached.has(name), name).toBe(false);
  });
});
