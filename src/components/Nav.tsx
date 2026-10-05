"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Search, FileText, Send, Globe2, ListChecks, ScanSearch, PenLine } from "lucide-react";

const LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/prospects", label: "Find Founders", icon: Search },
  { href: "/lists", label: "Lists & Upload", icon: ListChecks },
  { href: "/outreach", label: "Audit Outreach", icon: ScanSearch },
  { href: "/drafter", label: "Email Drafter", icon: PenLine },
  { href: "/templates", label: "Mail Templates", icon: FileText },
  { href: "/campaigns", label: "Campaigns", icon: Send },
];

export default function Nav() {
  const path = usePathname();
  return (
    <aside className="w-14 md:w-60 shrink-0 bg-[#1e1b4b] text-indigo-100 flex flex-col min-h-screen sticky top-0 self-start">
      <div className="px-4 md:px-5 py-5 flex items-center gap-2 border-b border-white/10">
        <Globe2 className="w-6 h-6 text-indigo-300" />
        <div className="hidden md:block">
          <div className="font-bold text-white leading-tight">GTM Flow</div>
          <div className="text-[11px] text-indigo-300">Founder Outreach Engine</div>
        </div>
      </div>
      <nav className="flex-1 p-2 md:p-3 space-y-1">
        {LINKS.map((l) => {
          const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
          const Icon = l.icon;
          return (
            <Link
              key={l.href}
              href={l.href}
              title={l.label}
              aria-label={l.label}
              className={`flex items-center justify-center md:justify-start gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active ? "bg-indigo-600 text-white" : "text-indigo-200 hover:bg-white/10"
              }`}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              <span className="hidden md:inline">{l.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="hidden md:block p-4 text-[11px] text-indigo-300/70 border-t border-white/10">
        Source → Template → Send → Track
      </div>
    </aside>
  );
}
