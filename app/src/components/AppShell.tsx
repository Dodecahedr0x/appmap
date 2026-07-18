import { Navbar } from "@/components/Navbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
      <footer className="border-t border-hairline bg-cream py-6 text-center text-caption text-slate-steel">
        nebulous.world · crowd-sourced app discovery on Solana · built for
        transparent, stake-aligned rankings
      </footer>
    </div>
  );
}
