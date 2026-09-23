import { CAN_DO, GATE_LINE } from "./askDemoScript";

/**
 * "What you can ask it to do", in as few words as it takes. Sits beside the
 * AskDemo scene on the landing page. No "use client": it is a list, and the
 * server can render a list.
 *
 * The groups and the command each line stands for live in
 * askDemoScript.ts (`CAN_DO`), where askDemoScript.test.ts holds every
 * command name against the registry in lib/ask/commands.ts. This file
 * only lays them out: a definition list, one row per group, the items
 * joined into a sentence, and the one line under it that says what the
 * box does before it writes anything.
 */
export function AskCanDo({ className = "" }: { className?: string }) {
  return (
    <div data-landing-ask-can-do className={className}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">What you can ask it to do</h3>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm leading-relaxed sm:text-base">
        {CAN_DO.map((group) => (
          <div key={group.group} className="contents">
            <dt className="font-semibold text-ink-label">{group.group}</dt>
            <dd className="min-w-0 text-ink-body">{group.items.map((item) => item.text).join(", ")}.</dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-sm font-medium leading-relaxed text-ink sm:text-base">{GATE_LINE}</p>
    </div>
  );
}
