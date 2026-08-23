import { UserButton } from "@clerk/nextjs";

export function Topbar() {
  return (
    <div className="print:hidden flex h-14 shrink-0 items-center justify-end border-b border-slate-800 bg-slate-950 px-6">
      <UserButton />
    </div>
  );
}
