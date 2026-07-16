import type { Metadata } from "next";
import "./globals.css";
import { SolanaProvider } from "@/components/providers/SolanaProvider";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { Navbar } from "@/components/Navbar";
import { Toaster } from "@/components/ui/Toaster";

export const metadata: Metadata = {
  title: "AppMap — discover the best apps, ranked by the crowd",
  description:
    "Crowd-sourced app discovery with advanced search, Solana-powered voting, tag staking, and traffic-based ad revenue sharing.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <SolanaProvider>
          <AuthProvider>
            <Toaster>
              <div className="flex min-h-screen flex-col">
                <Navbar />
                <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
                  {children}
                </main>
                <footer className="border-t border-surface-border py-6 text-center text-xs text-slate-500">
                  AppMap · crowd-sourced app discovery on Solana · built for
                  transparent, stake-aligned rankings
                </footer>
              </div>
            </Toaster>
          </AuthProvider>
        </SolanaProvider>
      </body>
    </html>
  );
}
