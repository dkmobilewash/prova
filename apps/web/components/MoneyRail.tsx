import { money } from "@/lib/money";
import type { MoneyRailFigure, MoneyRailStage } from "@/lib/moneyRail";

/**
 * The Money Rail — the nav-as-pipeline concept, rendered.
 *
 * PRESENTATIONAL ONLY. No data fetching, no Prisma, no auth: the caller
 * loads stages with getMoneyRailStages and hands them down, the same
 * split every dashboard panel uses. Deliberately NOT wired into any
 * layout or nav yet — the open nav PRs (#249) own those files, and this
 * component waits for them to land.
 *
 * Colors are Tailwind builtins on purpose: bg-neutral-900 is #171717 and
 * text-yellow-400 is #facc15, exactly the charcoal-ground / yellow-accent
 * concept, and neither depends on this branch's design tokens — so the
 * component renders the same whether it merges before or after the token
 * swap.
 *
 * All arithmetic and wording happens in lib/moneyRail.ts; this file only
 * formats. A money figure goes through lib/money.ts like every other
 * dollar figure in the app — the model never does arithmetic in the UI
 * layer, and the UI never invents a number the lib did not compute.
 */

function figureText(figure: MoneyRailFigure): string {
  return figure.kind === "money" ? money(figure.amount) : `${figure.n} ${figure.noun}`;
}

export function MoneyRail({ stages }: { stages: MoneyRailStage[] }) {
  return (
    <nav aria-label="Money pipeline" className="flex flex-col bg-neutral-900">
      <ol className="flex flex-col divide-y divide-neutral-800">
        {stages.map((stage) => (
          <li key={stage.key} className="px-4 py-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              {stage.label}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-yellow-400">
              {figureText(stage.figure)}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">{stage.detail}</p>
          </li>
        ))}
      </ol>
    </nav>
  );
}
