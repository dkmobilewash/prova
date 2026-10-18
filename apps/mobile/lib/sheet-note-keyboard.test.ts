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
 * **THE FIRST FIX FOR THIS DID NOTHING, AND THIS FILE WAS GREEN THE WHOLE
 * TIME.** #645 used a `KeyboardAvoidingView` with `behavior="padding"`, the
 * pattern `app/sign-in.tsx` uses. Build 15 went to a real phone and the
 * content did not move by a single pixel — field and button still under the
 * keyboard. The census asserted the component was present, which it was.
 *
 *     A census can tell you the code is THERE.
 *     It can never tell you a framework HONOURS it.
 *
 * A KeyboardAvoidingView inside a navigator is the fragile arrangement: it
 * measures the keyboard against the window while its own frame starts below
 * the header, so it wants a `keyboardVerticalOffset` nobody can state from
 * inside the file — and sign-in, where it does work, has no header at all.
 * `automaticallyAdjustKeyboardInsets` is the iOS-native answer and needs none
 * of it.
 *
 * **WHAT THIS TEST STILL CANNOT DO, which is the same thing it could not do
 * before.** It cannot prove the keyboard is avoided. No test here can:
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
  it("lets the scroll view handle the keyboard natively", () => {
    const text = code();
    expect(
      text,
      "the page scroll view no longer adjusts for the keyboard — the note field goes back under it",
    ).toMatch(/automaticallyAdjustKeyboardInsets/);
  });

  it("does NOT reach for a KeyboardAvoidingView again", () => {
    // Recorded as a guard because it is the obvious thing to try, it is what
    // this app does on sign-in, and it was measured NOT to work on this
    // screen. Without this the next person re-adds it and the bug comes back
    // with a green suite.
    expect(
      code(),
      "a KeyboardAvoidingView is back. It was tried in #645 and moved the content by zero pixels on " +
        "a real phone, because this screen sits inside a navigator and sign-in does not.",
    ).not.toMatch(/KeyboardAvoidingView/);
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
