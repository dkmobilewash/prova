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
    href: "/bids",
    label: "Bids",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M10 3.5v13M4.5 13c0 1.4 1.6 2.5 3.5 2.5h4c1.9 0 3.5-1.1 3.5-2.5s-1.6-2.5-3.5-2.5h-4c-1.9 0-3.5-1.1-3.5-2.5S6.1 5.5 8 5.5h4c1.9 0 3.5 1.1 3.5 2.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    href: "/catalog",
    label: "Catalog",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3.5 8h13M7.5 8v8.5" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    href: "/compliance",
    label: "Compliance",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M6 3.5h6l2.5 2.5v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M7 9.5h6M7 12.5h6M7 6.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
  {
    href: "/vendors",
    label: "Vendors",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M3 8.5 4.2 5A1.5 1.5 0 0 1 5.6 4h8.8a1.5 1.5 0 0 1 1.4 1L17 8.5M3 8.5h14M3 8.5V15a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 17 15V8.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M8 11.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/equipment",
    label: "Equipment",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M4 15.5h12M5.5 15.5V9l4-4.5 5 3.5v7.5M9.5 15.5v-3.5h2.5v3.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/punch-lists",
    label: "Punch lists",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M4 5.5 5.5 7l2.5-3M4 12.5 5.5 14l2.5-3M11 6h5M11 13h5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/rfis",
    label: "RFIs",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6A1.5 1.5 0 0 1 14.5 13H8l-4 3V5.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M8.5 7.4a1.6 1.6 0 1 1 1.9 1.9v.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/safety",
    label: "Safety",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M10 3 4.5 5.2v4.4c0 3.2 2.3 6 5.5 6.9 3.2-.9 5.5-3.7 5.5-6.9V5.2L10 3Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M7.7 9.8 9.4 11.5l3-3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/cash-flow",
    label: "Cash flow",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M3.5 14.5V9M8 14.5v-8M12.5 14.5v-5M17 14.5V6"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <circle cx="10" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M10 3.5v1.6M10 14.9v1.6M16.5 10h-1.6M5.1 10H3.5M14.6 5.4l-1.13 1.13M6.53 13.47 5.4 14.6M14.6 14.6l-1.13-1.13M6.53 6.53 5.4 5.4"
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
