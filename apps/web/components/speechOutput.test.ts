// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  READ_ALOUD_KEY,
  SPEAK_CAP,
  SPEAK_REST_NOTE,
  readAloudPreference,
  rememberReadAloud,
  speakableText,
  speechSynthesisFrom,
} from "@/components/speechOutput";

describe("speakableText", () => {
  it("keeps link words and drops the URL", () => {
    expect(speakableText("See [Riverside job](/jobs/abc123) for details.")).toBe("See Riverside job for details.");
    expect(speakableText("Open https://app.cstream.ai/jobs/1 now")).toBe("Open now");
  });

  it("drops tables and code blocks entirely", () => {
    const md =
      "Two are overdue.\n\n| Job | Owed |\n|---|---|\n| Riverside | $4,200 |\n\n```\nselect 1\n```\nCall them today.";
    const out = speakableText(md);
    expect(out).toBe("Two are overdue. Call them today.");
    expect(out).not.toMatch(/[|`]|Riverside|select/);
  });

  it("strips headings, bullets, emphasis and inline code marks", () => {
    const md = "## Today\n- **Tino** on `Riverside`\n- _Ana_ off\n1. Pay app due";
    expect(speakableText(md)).toBe("Today. Tino on Riverside. Ana off. Pay app due");
  });

  it("does not double a sentence's own full stop at a line break", () => {
    expect(speakableText("First line.\nSecond line!\nThird")).toBe("First line. Second line! Third");
  });

  it("returns empty when nothing speakable is left", () => {
    expect(speakableText("| a | b |\n|---|---|")).toBe("");
  });

  it("caps long replies at a word boundary and says the rest is on screen", () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const out = speakableText(long);
    expect(out.endsWith(` ${SPEAK_REST_NOTE}`)).toBe(true);
    const spoken = out.slice(0, -SPEAK_REST_NOTE.length - 1);
    expect(spoken.length).toBeLessThanOrEqual(SPEAK_CAP);
    expect(spoken.length).toBeGreaterThan(SPEAK_CAP - 12);
    expect(long.startsWith(spoken)).toBe(true);
    expect(long.charAt(spoken.length)).toBe(" "); // a whole word, never half
  });

  it("leaves a reply under the cap alone", () => {
    expect(speakableText("Short answer.")).toBe("Short answer.");
  });
});

describe("speechSynthesisFrom", () => {
  it("is null without both the synthesiser and the utterance constructor", () => {
    expect(speechSynthesisFrom(null)).toBeNull();
    expect(speechSynthesisFrom({})).toBeNull();
    expect(speechSynthesisFrom({ speechSynthesis: {} })).toBeNull();
    expect(speechSynthesisFrom({ speechSynthesis: {}, SpeechSynthesisUtterance: function U() {} })).not.toBeNull();
  });
});

describe("read-aloud preference", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("is off by default and round-trips", () => {
    expect(readAloudPreference()).toBe(false);
    rememberReadAloud(true);
    expect(window.localStorage.getItem(READ_ALOUD_KEY)).toBe("on");
    expect(readAloudPreference()).toBe(true);
    rememberReadAloud(false);
    expect(window.localStorage.getItem(READ_ALOUD_KEY)).toBeNull();
    expect(readAloudPreference()).toBe(false);
  });

  it("reads as off and writes nothing when storage throws", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.spyOn(window.localStorage, "getItem").mockImplementation(boom);
    vi.spyOn(window.localStorage, "setItem").mockImplementation(boom);
    expect(readAloudPreference()).toBe(false);
    expect(() => rememberReadAloud(true)).not.toThrow();
  });
});
