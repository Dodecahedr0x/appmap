import type { Metadata } from "next";
import Link from "next/link";

// Next.js serves this for both unmatched routes and explicit notFound()
// calls (e.g. app/[slug]/page.tsx for an unknown slug), automatically with
// an HTTP 404 status — a real 404 (not a soft 404 rendered under a 200)
// matters for SEO: it tells crawlers not to index the URL or waste further
// crawl budget on it. `noindex` here is belt-and-suspenders on top of that.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="grid min-h-[50vh] place-items-center py-16 text-center">
      <div>
        <p className="font-display text-heading-lg font-bold text-ink">404</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">
          This page doesn&apos;t exist
        </h1>
        <p className="mt-2 text-slate">
          The app or page you&apos;re looking for may have been removed, renamed, or never existed.
        </p>
        <Link href="/" className="btn-primary mt-6 inline-flex">
          ← Back to Discover
        </Link>
      </div>
    </div>
  );
}
