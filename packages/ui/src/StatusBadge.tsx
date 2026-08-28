const STYLES: Record<string, string> = {
  ESTIMATE: "bg-slate-800 text-slate-300 ring-1 ring-inset ring-slate-700",
  CONTRACTED: "bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-500/30",
  IN_PROGRESS: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30",
  COMPLETE: "bg-green-500/15 text-green-300 ring-1 ring-inset ring-green-500/30",
  // Not a JobStatus: the client's signed view of a contract. Signing does not
  // contract the job -- the contractor still has to accept it -- so this
  // deliberately reads differently from CONTRACTED.
  SIGNED: "bg-green-500/15 text-green-300 ring-1 ring-inset ring-green-500/30",
};

const LABELS: Record<string, string> = {
  ESTIMATE: "Estimate",
  CONTRACTED: "Contracted",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
  SIGNED: "Signed",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? "bg-slate-800 text-slate-300 ring-1 ring-inset ring-slate-700";
  const label = LABELS[status] ?? status;

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}
