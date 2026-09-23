/**
 * Every stop of "Take the full tour" goes to a real page and points at
 * something that page renders.
 *
 * The same argument as walkthroughCensus.test.ts, and the same helpers:
 * the overlay skips an anchor that is not on screen without a sound, which
 * is right for a hidden section and wrong for an anchor that no longer
 * exists anywhere. This tells the two apart at build time.
 *
 * TWO INDEPENDENT COUNTS, because a check that derives its input can get an
 * empty question (CLAUDE.md). The stops are counted from the source text of
 * full-tour.ts, not from the imported array, and every anchor this file
 * checks is counted against the `anchor: "` literals in that same text — so
 * a stop or a step the checks below silently never reached goes red here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { anchorsReachedFromPage, pageFiles, pages, pagesByGit } from "./census-helpers";
import { FULL_TOUR } from "./full-tour";
import { walkthroughFor } from "./index";

const source = readFileSync(fileURLToPath(new URL("./full-tour.ts", import.meta.url)), "utf8");
const routeLiterals = [...source.matchAll(/\broute: "(\/[^"]*)"/g)].map((match) => match[1]);
const anchorLiterals = [...source.matchAll(/\banchor: "([^"]+)"/g)].map((match) => match[1]);

describe("the full tour census sees what it reasons about", () => {
  it("reads the same page files as git", () => {
    expect(pageFiles.length).toBe(pagesByGit().length);
    expect(pageFiles.length).toBeGreaterThan(40);
  });

  it("checks exactly the stops and steps full-tour.ts declares", () => {
    expect(FULL_TOUR.length, "the tour has almost no stops").toBeGreaterThanOrEqual(8);
    expect(FULL_TOUR.map((stop) => stop.route)).toEqual(routeLiterals);
    expect(FULL_TOUR.flatMap((stop) => stop.steps.map((step) => step.anchor))).toEqual(anchorLiterals);
  });
});

describe("full tour stops", () => {
  it("ids and routes are unique", () => {
    const ids = FULL_TOUR.map((stop) => stop.id);
    const routes = FULL_TOUR.map((stop) => stop.route);
    expect(new Set(ids).size, "a stop id is used twice").toBe(ids.length);
    expect(new Set(routes).size, "a page is visited twice").toBe(routes.length);
  });

  it("every stop is a real, static page the tour can navigate to", () => {
    const bad = FULL_TOUR.filter((stop) => !pages.has(stop.route) || /\[/.test(stop.route)).map((s) => s.route);
    expect(bad, "no page.tsx for these (or a [param] the tour cannot fill in)").toEqual([]);
  });

  it("every anchor is a step of that page's own walkthrough AND a data-tour literal its page renders", () => {
    let checked = 0;
    const missing: string[] = [];
    for (const stop of FULL_TOUR) {
      const own = new Set(walkthroughFor(stop.route)?.steps.map((step) => step.anchor) ?? []);
      const rendered = anchorsReachedFromPage(stop.route);
      for (const { anchor } of stop.steps) {
        checked += 1;
        if (!own.has(anchor)) missing.push(`${stop.route}: ${anchor} is not in its walkthrough`);
        if (!rendered.has(anchor)) missing.push(`${stop.route}: no data-tour="${anchor}" in the page or its imports`);
      }
    }
    expect(missing).toEqual([]);
    // Requested vs returned: every declared anchor was actually checked.
    expect(checked).toBe(anchorLiterals.length);
  });

  it("each stop has one to three short, plain steps", () => {
    for (const stop of FULL_TOUR) {
      expect(stop.title.trim(), stop.id).not.toBe("");
      expect(stop.steps.length, `${stop.id}: one to three steps`).toBeGreaterThanOrEqual(1);
      expect(stop.steps.length, `${stop.id}: one to three steps`).toBeLessThanOrEqual(3);
      const anchors = stop.steps.map((step) => step.anchor);
      expect(new Set(anchors).size, `${stop.id}: an anchor twice`).toBe(anchors.length);
      for (const step of stop.steps) {
        expect(step.title.trim(), step.anchor).not.toBe("");
        const sentences = step.body.split(/[.!?](?:\s|$)/).filter((part) => part.trim() !== "");
        expect(sentences.length, `${step.anchor}: say it in 1-3 sentences`).toBeLessThanOrEqual(3);
        expect(step.body.length, `${step.anchor}: too long for a phone sheet`).toBeLessThanOrEqual(300);
      }
    }
  });
});
