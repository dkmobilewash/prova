import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE NOTE FIELD MUST NOT SIT UNDER THE KEYBOARD.
 *
 * Reported from a real phone on 2026-10-06: placing a pin opens the note card
 * at the bottom of the screen — deliberately, because the phone is held
 * one-handed and often on a ladder — and the keyboard then covered it, so you
 * could not see what you were typing.
 *
 * **WHAT THIS TEST CANNOT DO, said plainly, because this repo has a scar about
 * exactly that.** It cannot prove the keyboard is avoided. No test here can:
 * the screen suite renders in happy-dom, which does no layout, returns zeros
 * from `getBoundingClientRect`, and has no keyboard at all. This is a PRESENCE
 * census — the same instrument that passed on three broken expo-router header
 * fixes in a row, with its size and scope assertions both holding.
 *
 *     A census can tell you the code is THERE.
 *     It can never tell you a framework HONOURS it.
 *
 * So the verdict on this fix comes from a phone, and nowhere else. What this
 * file is for is narrower and still worth having: once somebody HAS confirmed
 * it on a device, this stops it being quietly removed by a later tidy-up —
 * `KeyboardAvoidingView` around a ScrollView reads like redundant nesting if
 * you have never seen the bug.
 */

const SCREEN = join(__dirname, "..", "app", "sheets", "[jobId].tsx");

function code(): string {
  return readFileSync(SCREEN, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("the sheet note field stays clear of the keyboard", () => {
  it("wraps the screen in a KeyboardAvoidingView, iOS behaviour set", () => {
    const text = code();
    expect(text, "the screen is no longer keyboard-aware — the note field goes back under the keyboard").toMatch(
      /<KeyboardAvoidingView[\s\S]{0,160}behavior=\{Platform\.OS === "ios" \? "padding" : undefined\}/,
    );
  });

  it('keeps keyboardShouldPersistTaps, or the first tap on "Place note" is eaten', () => {
    // Not the reported bug, and a real one: without this the first tap with
    // the keyboard up only dismisses it. Nobody reports that — they tap twice
    // and never notice they did.
    expect(code(), "a tap on Place note will dismiss the keyboard instead of saving").toMatch(
      /keyboardShouldPersistTaps="handled"/,
    );
  });

  it("scrolls the note card into view when the field takes focus", () => {
    // Lifting the view does not show a card that is below the fold. These are
    // two different problems and the fix needs both halves.
    expect(code(), "focusing the note no longer brings its card into view").toMatch(
      /onFocus=\{\(\) => \{[\s\S]{0,200}scrollToEnd/,
    );
  });

  it("still renders exactly one note input, so this census is not guarding a deleted screen", () => {
    // The size assertion. A census that parses nothing passes everything.
    const inputs = code().match(/<TextInput/g) ?? [];
    expect(inputs.length, "the note input is gone — this file is guarding nothing").toBe(1);
  });
});
