import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditLine, auditSheet, type AuditInput, type SheetAudit } from "../labelAudit";
import { finderVersion, UNKNOWN_FINDER } from "../finderVersion";
import { heldOutReason } from "../heldOutSets";

/**
 * ── THE LABEL AUDIT, OVER WHATEVER HAS BEEN SAVED ──
 *
 * Reads label files and NOTHING else: no PDF, no database, no finder. That is
 * deliberate — it means this can run while somebody is labelling the next
 * sheet, which is when it is wanted.
 *
 * Writes nothing. The one thing an audit must never do is edit what it is
 * auditing.
 *
 *     ./scripts/audit-labels.sh              # every sheet
 *     ./scripts/audit-labels.sh E_Street     # one set
 *     ./scripts/audit-labels.sh E_Street/A2.1
 *
 * ── THE RULES-ONLY SCORE, AND WHAT IT CANNOT SAY ──
 *
 * For a TRAINING sheet the file gives two honest numbers: what the finder
 * proposed and the reviewer accepted, and what it proposed and the reviewer
 * rejected. The second is EXTRA footage — walls the finder would have billed
 * that are not walls.
 *
 * It cannot give MISSING footage. A training sheet has no traces, so there is
 * no record of a wall the finder never proposed, and a finder that proposes
 * nothing would score zero extra and look perfect. That number needs the
 * held-out sheets, and this says so rather than printing a figure that reads
 * like completeness.
 */
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const ONLY = (process.env.AUDIT_ONLY ?? "").trim();

type Saved = AuditInput & {
  counts?: { unreviewed?: number; accepted?: number; rejected?: number };
};

describe.skipIf(LABELS === "")("auditing the saved labels", () => {
  it("flags what is wrong and says what it cannot measure", { timeout: 600_000 }, () => {
    const files: { dir: string; sheet: string; path: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      const full = join(LABELS, dir);
      if (!existsSync(full)) continue;
      let names: string[] = [];
      try {
        names = readdirSync(full).filter((n) => n.endsWith(".json"));
      } catch {
        continue;
      }
      for (const name of names) {
        const sheet = name.slice(0, -5);
        if (ONLY !== "" && !`${dir}/${sheet}`.toLowerCase().includes(ONLY.toLowerCase())) continue;
        files.push({ dir, sheet, path: join(full, name) });
      }
    }

    const now = finderVersion();
    const audits: SheetAudit[] = [];
    const unreadable: string[] = [];
    for (const file of files) {
      let saved: Saved;
      try {
        saved = JSON.parse(readFileSync(file.path, "utf8")) as Saved;
      } catch (e) {
        // A file being written as this reads is normal while labelling; it is
        // reported rather than crashing the run or passing as clean.
        unreadable.push(`${file.dir}/${file.sheet}: ${String(e).slice(0, 60)}`);
        continue;
      }
      audits.push(
        auditSheet(
          { ...saved, set: saved.set || file.dir, sheet: saved.sheet || file.sheet },
          now === UNKNOWN_FINDER ? null : now,
        ),
      );
    }

    const flagged = audits.filter((a) => a.flags.length > 0);
    const held = audits.filter((a) => heldOutReason(a.set) !== null);
    const training = audits.filter((a) => heldOutReason(a.set) === null);

    const detail = flagged
      .map(
        (a) =>
          `\n  ${a.set}/${a.sheet}\n` +
          a.flags.map((f) => `      ⚑ ${f}`).join("\n") +
          (a.overlaps.length === 0
            ? ""
            : `\n${a.overlaps
                .slice(0, 6)
                .map((o) => `        ${o.kind}: ${o.feet.toFixed(1)} ft — ${o.a} / ${o.b}`)
                .join("\n")}`) +
          (a.overlaps.length > 6 ? `\n        … and ${a.overlaps.length - 6} more` : ""),
      )
      .join("\n");

    const rules =
      training.length === 0
        ? "  (no training sheets)"
        : training
            .map(
              (a) =>
                `  ${a.set.slice(0, 30).padEnd(30)} ${a.sheet.padEnd(7)}` +
                ` accepted ${a.acceptedFeet.toFixed(0).padStart(5)} ft · ` +
                `EXTRA ${a.rejectedFeet.toFixed(0).padStart(6)} ft rejected` +
                ` (${a.rejected} runs)`,
            )
            .join("\n");

    // eslint-disable-next-line no-console
    console.log(
      `\n── ${audits.length} sheet(s) audited, finder now ${now} ──\n` +
        audits.map((a) => `  ${auditLine(a)}`).join("\n") +
        `\n\n── RULES-ONLY, TRAINING SHEETS ──\n${rules}\n` +
        `  MISSING ft is NOT measurable here: a training sheet has no traces, so a\n` +
        `  wall the finder never proposed leaves no record. A finder that proposed\n` +
        `  nothing would show zero extra and look perfect. Missing needs the\n` +
        `  held-out sheets (${held.length} labelled so far).\n` +
        (flagged.length === 0
          ? "\n── NOTHING FLAGGED ──"
          : `\n── ${flagged.length} SHEET(S) FLAGGED ──${detail}`) +
        (unreadable.length === 0 ? "" : `\n\n  unreadable: ${unreadable.join("; ")}`),
    );

    // The harness, not the findings: a run over nothing must not read clean.
    expect(files.length, "no label files matched — check TAKEOFF_LABEL_DIR or the filter").toBeGreaterThan(0);
    expect(
      audits.length + unreadable.length,
      "a label file was neither audited nor reported unreadable",
    ).toBe(files.length);
  });
});
