"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { ConnectButton } from "@/components/ConnectButton";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Discover" },
  { href: "/explore", label: "Explore" },
  { href: "/rewards", label: "Rewards" },
  { href: "/about", label: "About" },
];

export function Navbar() {
  const pathname = usePathname();
  const { connected } = useWallet();
  return (
    <header className="navbar-chrome sticky top-0 z-40 border-b border-hairline/70 bg-cream/75 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/nebulous_logo.png"
              alt=""
              width={32}
              height={32}
              priority
              className="h-8 w-8 rounded-icon"
            />
            <span className="text-lg font-bold tracking-tight text-ink">
              nebulous.<span className="text-cobalt">world</span>
            </span>
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
                    "flex items-center gap-1.5 rounded-navitem px-3 py-2 text-sm font-medium transition-[color,background-color] duration-150 ease-spring",
                    active
                      ? "bg-ivory text-ink"
                      : "text-slate hover:text-ink",
                  )}
                >
                  {item.label}
                  {/* A live-status pulse, not decoration — see DESIGN.md's
                      Navigation Bar component and its Don'ts ("reserve
                      pulse-live for things that are genuinely live"): the
                      active route only carries it once a wallet is
                      connected, i.e. there's actually something of yours
                      being tracked live on that page. */}
                  {active && connected && (
                    <span
                      className="h-1.5 w-1.5 animate-pulse-live rounded-full bg-forest"
                      aria-hidden="true"
                    />
                  )}
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
