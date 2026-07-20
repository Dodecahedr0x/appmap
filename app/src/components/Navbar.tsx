"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { ConnectButton } from "@/components/ConnectButton";
import { useUserLevel } from "@/hooks/useUserLevel";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { config } from "@/lib/config";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { cn, formatToken } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Browse" },
  { href: "/rankings", label: "Rankings" },
  { href: "/rewards", label: "Rewards" },
  { href: "/about", label: "About" },
];

export function Navbar() {
  const pathname = usePathname();
  const { connected } = useWallet();
  const { neb } = useWalletBalances(config.solana.voteTokenMint || null, null);
  const userLevel = useUserLevel();
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-cream">
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
                    "rounded-navitem px-3 py-2 text-sm font-medium transition-colors duration-150",
                    active
                      ? "bg-indigo-soft text-cobalt"
                      : "text-slate hover:text-ink",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {connected && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-forest"
              aria-hidden="true"
            />
          )}
          {connected && userLevel && (
            <Link href="/profile" className="chip chip-active font-mono tabular-nums">
              Lv {userLevel.level}
            </Link>
          )}
          {connected && neb !== null && (
            <span className="chip font-mono tabular-nums">{formatToken(neb, TOKEN_SYMBOL)}</span>
          )}
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
