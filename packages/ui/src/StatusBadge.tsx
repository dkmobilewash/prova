/**
 * Job status as a tag: light ground, saturated text.
 *
 * Replaces the dark theme's translucent ring-inset treatment, which
 * disappears against a light surface. Deliberately not a solid fill — a
 * list of solid badges reads as a page of alarms rather than a column of
 * states.
 */
const STYLES: Record<string, string> = {
  ESTIMATE: "bg-tag-slate text-tag-slate-ink",
  CONTRACTED: "bg-tag-blue text-tag-blue-ink",
  IN_PROGRESS: "bg-tag-amber text-tag-amber-ink",
  COMPLETE: "bg-tag-green text-tag-green-ink",
  // Not a JobStatus: the client's signed view of a contract. Signing does
  // not contract the job -- the contractor still has to accept it -- so
  // this deliberately reads differently from CONTRACTED.
  SIGNED: "bg-tag-green text-tag-green-ink",
  // Integration connection states. Additive: this component already keys off
  // a plain string with a slate fallback, and already carried SIGNED, which
  // is not a JobStatus either. NEEDS_REAUTH is amber rather than red on
  // purpose — somebody has to re-authorise, which is a task, not a fault.
  CONNECTED: "bg-tag-green text-tag-green-ink",
  NOT_CONNECTED: "bg-tag-slate text-tag-slate-ink",
  NEEDS_REAUTH: "bg-tag-amber text-tag-amber-ink",
  ERROR: "bg-tag-rose text-tag-rose-ink",
};

const LABELS: Record<string, string> = {
  ESTIMATE: "Estimate",
  CONTRACTED: "Contracted",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
  SIGNED: "Signed",
  CONNECTED: "Connected",
  NOT_CONNECTED: "Not connected",
  NEEDS_REAUTH: "Needs reauth",
  ERROR: "Error",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? "bg-tag-slate text-tag-slate-ink";
  const label = LABELS[status] ?? status;

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}
