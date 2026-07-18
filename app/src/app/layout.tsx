import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { SolanaProvider } from "@/components/providers/SolanaProvider";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { Toaster } from "@/components/ui/Toaster";
import { SITE_NAME, SITE_DESCRIPTION, SITE_URL } from "@/lib/constants";

const title = `${SITE_NAME} — discover the best apps, ranked by the crowd`;

// DESIGN.md's display face is the proprietary 'Obviously' — Space Grotesk is
// its own documented substitute ("No web-safe substitute captures the feel
// — Inter Black or Space Grotesk Bold approximate it").
const bodySans = Inter({
  subsets: ["latin"],
  variable: "--font-ui-sans-serif",
  weight: ["400", "500", "600", "700"],
});
const displaySans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-obviously",
  weight: ["300", "400", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: title, template: `%s — ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  icons: { icon: "/favicon.ico" },
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
    <html lang="en" className={`${bodySans.variable} ${displaySans.variable}`}>
      <body className="bg-cream font-sans text-ink antialiased">
        <SolanaProvider>
          <AuthProvider>
            <Toaster>
              <AppShell>{children}</AppShell>
            </Toaster>
          </AuthProvider>
        </SolanaProvider>
      </body>
    </html>
  );
}
