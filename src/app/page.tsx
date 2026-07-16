import Link from "next/link";

// Placeholder home page. Replaced by the full Discover/search experience in the
// search milestone.
export default function HomePage() {
  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <h1 className="bg-brand-gradient bg-clip-text text-4xl font-black text-transparent sm:text-5xl">
        Discover the best apps, ranked by the crowd
      </h1>
      <p className="mt-4 text-slate-400">
        AppMap is a crowd-sourced directory where the community curates,
        votes, and stakes to surface great apps — and shares in the ad revenue
        their attention creates.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Link href="/submit" className="btn-primary">
          Submit an app
        </Link>
        <Link href="/analytics" className="btn-secondary">
          View analytics
        </Link>
      </div>
    </div>
  );
}
