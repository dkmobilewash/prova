import { UserButton } from "@clerk/nextjs";
import { MobileNav } from "@/components/MobileNav";

export function Topbar({ companyName }: { companyName: string }) {
  return (
    <div className="print:hidden flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line-card bg-surface px-4 sm:px-6">
      {/* Renders nothing above md — the desktop rail is always visible there. */}
      <MobileNav companyName={companyName} />
      <div className="ml-auto">
        <UserButton />
      </div>
    </div>
  );
}
