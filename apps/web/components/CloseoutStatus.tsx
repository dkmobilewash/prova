import type { CloseoutItem } from "@/lib/billing/closeout-billing";

/** Read only. Each line is what the records show, in words and a mark, so the
 * status never rests on colour alone. Nothing here says the job is closed out. */
export function CloseoutStatus({ items }: { items: CloseoutItem[] }) {
  return (
    <section className="rounded-lg border border-line-card bg-surface p-4" aria-label="Closeout billing">
      <h2 className="text-sm font-semibold text-ink-label">Closeout billing</h2>
      <p className="mt-1 text-xs text-ink-muted">From this job&apos;s records. Something done outside the app does not show here.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.label} className="text-sm">
            <span className={item.done ? "text-ok" : "text-ink-body"}>{item.done ? "Done" : "Open"}</span>
            <span className="text-ink-label"> · {item.label}</span>
            <span className="block text-xs text-ink-muted">{item.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
