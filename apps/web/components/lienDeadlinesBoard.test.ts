/**
 * LienDeadlinesBoard, read as source — no test in this repo can render a
 * page (see jobPickerCensus.test.ts), so the two defects review found on
 * this component are pinned on the text that produces them.
 *
 * 1. A FAILED SAVE MUST NOT WIPE THE FORM. `<form action={fn}>` hands the
 *    submit to React, and the installed react-dom (`startHostTransition`)
 *    calls `requestFormReset` UNCONDITIONALLY before the action runs — so a
 *    returned `{ ok: false }` still cleared every field typed, and the
 *    person reading "that date is in the future" had nothing left to fix.
 *    The repo's pattern is `onSubmit` + `preventDefault` inside a
 *    transition, resetting only on success (LogTimeEntryForm).
 *
 * 2. THE JOB PICKER MUST START EMPTY. Without a placeholder option the
 *    browser preselects the first job, so a deadline typed without touching
 *    the picker saved against the newest job — the server's "Pick a job."
 *    could never fire, and job is not editable afterwards.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./LienDeadlinesBoard.tsx", import.meta.url)), "utf8");

/** Same stripping as the censuses: a scan that reads its own comments is a
 * check that cannot fail, and this component's comments mention `action=`. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function formTags(text: string): string[] {
  return text.match(/<form\b[\s\S]*?>/g) ?? [];
}

describe("LienDeadlinesBoard forms keep what was typed when a save fails", () => {
  it("finds the three forms, so an empty scan cannot pass", () => {
    // create, mark served, edit
    expect(formTags(code)).toHaveLength(3);
  });

  it("submits none of them through `<form action>`, which React resets before the action runs", () => {
    expect(code).not.toMatch(/action=\{\s*\(formData\)/);
    for (const tag of formTags(code)) {
      expect(tag).not.toMatch(/\baction=/);
      expect(tag).toMatch(/onSubmit=/);
    }
  });

  it("prevents the browser's own submit in every handler", () => {
    // Either inline, or through the component's one shared submit helper —
    // which must itself be the thing that calls preventDefault.
    const helper = code.match(/function submitForm\([\s\S]*?\n\}/)?.[0] ?? "";
    const helperPrevents = /event\.preventDefault\(\)/.test(helper);
    const handlers = [...code.matchAll(/onSubmit=\{\(event\) =>\s*([\s\S]{0,120})/g)].map((m) => m[1]);
    expect(handlers).toHaveLength(3);
    for (const body of handlers) {
      const inline = body.includes("event.preventDefault()");
      const viaHelper = helperPrevents && /^(submitForm|submit)\(event\b/.test(body.trim());
      expect(inline || viaHelper, `handler does not prevent the submit: ${body}`).toBe(true);
    }
    if (code.includes("submit(event")) {
      // The row's `submit` wrapper must hand the event to the helper.
      expect(code).toMatch(/const submit = \(event[\s\S]*?=>\s*submitForm\(event/);
    }
  });

  it("resets a form only on the success path", () => {
    const resets = [...code.matchAll(/\.reset\(\)/g)].map((m) => m.index as number);
    expect(resets.length).toBeGreaterThan(0);
    for (const at of resets) {
      const before = code.slice(0, at);
      const okBranch = before.lastIndexOf("if (result.ok)");
      expect(okBranch, "a reset() outside an `if (result.ok)` branch").toBeGreaterThan(-1);
      // Nothing between the success check and the reset may leave that branch.
      expect(code.slice(okBranch, at)).not.toMatch(/\}\s*else|return\b/);
    }
  });
});

describe("LienDeadlinesBoard job picker", () => {
  it("opens on a disabled 'Choose a job' placeholder, not on the newest job", () => {
    const select = code.match(/<select\s+name="jobId"[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(select).not.toBe("");
    expect(select).toMatch(/defaultValue=""/);
    const firstOption = select.match(/<option\b[\s\S]*?<\/option>/)?.[0] ?? "";
    expect(firstOption).toMatch(/value=""/);
    expect(firstOption).toMatch(/\bdisabled\b/);
    expect(firstOption).toContain("Choose a job");
  });
});
