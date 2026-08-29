"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/components/navItems";
import type { ReactNode } from "react";

export function Sidebar({ companyName }: { companyName: string }) {
  const pathname = usePathname();

  // Desktop rail. On small screens the same links live in MobileNav's
  // drawer — a 240px column on a 360px phone leaves no room to work.
  return (
    <aside className="print:hidden sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900 md:flex">
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
