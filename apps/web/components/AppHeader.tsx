import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

export function AppHeader({ companyName }: { companyName: string }) {
  return (
    <div className="mb-8 flex items-center justify-between">
      <div>
        <p className="text-2xl font-semibold">{companyName}</p>
        <nav className="mt-1 flex gap-4 text-sm text-slate-600">
          <Link href="/dashboard" className="hover:text-slate-900 hover:underline">
            Jobs
          </Link>
          <Link href="/contacts" className="hover:text-slate-900 hover:underline">
            Contacts
          </Link>
          <Link href="/team" className="hover:text-slate-900 hover:underline">
            Team
          </Link>
        </nav>
      </div>
      <UserButton />
    </div>
  );
}
