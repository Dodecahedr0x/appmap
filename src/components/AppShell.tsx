"use client";

import { usePathname } from "next/navigation";
import { Navbar } from "@/components/Navbar";

// Full-bleed routes render their own chrome (or none) instead of the
// standard nav/footer/max-width shell — e.g. /future is an immersive,
// edge-to-edge single-page experience.
const FULL_BLEED_PREFIXES = ["/future"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullBleed = FULL_BLEED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (fullBleed) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
      <footer className="border-t border-hairline bg-white py-6 text-center text-caption text-slate-steel">
        nebulous.world · crowd-sourced app discovery on Solana · built for
        transparent, stake-aligned rankings
      </footer>
    </div>
  );
}
