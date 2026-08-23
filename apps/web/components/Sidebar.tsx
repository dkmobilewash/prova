"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV_ITEMS: { href: string; label: string; icon: ReactNode }[] = [
  {
    href: "/dashboard",
    label: "Jobs",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M6.5 6V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1M4 8.5A1.5 1.5 0 0 1 5.5 7h9A1.5 1.5 0 0 1 16 8.5V15a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15V8.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M4 10.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/schedule",
    label: "Schedule",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3.5 8.5h13M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/contacts",
    label: "Contacts",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M4.5 16c0-2.8 2.46-4.5 5.5-4.5s5.5 1.7 5.5 4.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    href: "/team",
    label: "Team",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <circle cx="7" cy="7" r="2.4" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="14" cy="8.5" r="2" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M2.8 16c0-2.4 2-4 4.2-4s4.2 1.6 4.2 4M12.2 12.6c1.7.1 3.2 1.4 3.2 3.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export function Sidebar({ companyName }: { companyName: string }) {
  const pathname = usePathname();

  return (
    <aside className="print:hidden flex h-screen w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      <div className="flex flex-col gap-0.5 border-b border-slate-800 px-5 py-5">
        <span className="text-sm font-semibold tracking-tight text-slate-100">Prova</span>
        <span className="truncate text-xs text-slate-400">{companyName}</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-500/15 text-blue-300"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
