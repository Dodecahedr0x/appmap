"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/ConnectButton";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Discover" },
  { href: "/tags", label: "Tags" },
  { href: "/submit", label: "Submit app" },
  { href: "/analytics", label: "Analytics" },
  { href: "/rewards", label: "Rewards" },
  { href: "/future", label: "The Future" },
];

export function Navbar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-white">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-icon bg-cobalt text-lg font-black text-white">
              A
            </span>
            <span className="text-lg font-bold tracking-tight text-ink">nebulous.world</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-navitem px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-ivory text-ink"
                      : "text-slate hover:text-ink",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <ConnectButton />
      </div>
    </header>
  );
}
