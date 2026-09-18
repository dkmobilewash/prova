import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from "@/lib/signature-path";

/**
 * A drawn signature, from the path the phone recorded. The server only ever
 * stores `M`/`L` whole-pixel points (isValidSignaturePath), so the path is
 * handed straight to `d` — there is nothing in that shape that could be
 * markup. Always on white: it is ink on paper, whatever the page's theme.
 */
export function SignatureImage({ path, label, className }: { path: string; label: string; className?: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`}
      className={className ?? "h-16 w-32 rounded border border-slate-700 bg-white"}
    >
      <path d={path} fill="none" stroke="#111111" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
