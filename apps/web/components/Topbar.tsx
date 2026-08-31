import { UserButton } from "@clerk/nextjs";
import { MobileNav } from "@/components/MobileNav";

/** Chrome stays dark alongside the rail, so the frame is one thing and the
 * page inside it is another. Converts to the light tokens when the pages
 * it frames do. */
export function Topbar({ companyName }: { companyName: string }) {
  return (
    <div className="print:hidden flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 sm:px-6">
      {/* Renders nothing above md — the desktop rail is always visible there. */}
      <MobileNav companyName={companyName} />
      <div className="ml-auto">
        <UserButton />
      </div>
    </div>
  );
}
