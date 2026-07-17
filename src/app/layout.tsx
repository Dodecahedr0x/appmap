import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SolanaProvider } from "@/components/providers/SolanaProvider";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { Navbar } from "@/components/Navbar";
import { Toaster } from "@/components/ui/Toaster";
import { SITE_NAME, SITE_DESCRIPTION, SITE_URL } from "@/lib/constants";

const title = `${SITE_NAME} — discover the best apps, ranked by the crowd`;

const roobert = Inter({
  subsets: ["latin"],
  variable: "--font-roobert",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: title, template: `%s — ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  openGraph: {
    title,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={roobert.variable}>
      <body className="bg-cream font-sans text-ink antialiased">
        <SolanaProvider>
          <AuthProvider>
            <Toaster>
              <div className="flex min-h-screen flex-col">
                <Navbar />
                <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
                  {children}
                </main>
                <footer className="border-t border-hairline bg-white py-6 text-center text-caption text-slate-steel">
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
