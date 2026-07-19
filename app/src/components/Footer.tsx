import Link from "next/link";
import { SITE_DOCS_URL, SITE_GITHUB_URL, SITE_TWITTER_URL } from "@/lib/constants";

const ICON_LINK_CLASS =
  "text-slate transition-colors duration-150 ease-spring hover:text-ink";

export function Footer() {
  return (
    <footer className="border-t border-hairline bg-cream">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-4 px-4 py-8 text-center sm:flex-row sm:justify-between sm:px-6 sm:text-left lg:px-8">
        <p className="text-caption text-slate-steel">
          nebulous.world · crowd-sourced app discovery on Solana · built for
          transparent, stake-aligned rankings
        </p>
        <nav className="flex items-center gap-5" aria-label="Footer">
          <Link
            href="/about"
            className="text-body-sm font-medium text-slate transition-colors duration-150 ease-spring hover:text-ink"
          >
            About
          </Link>
          <a
            href={SITE_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-body-sm font-medium text-slate transition-colors duration-150 ease-spring hover:text-ink"
          >
            Docs
          </a>
          <a
            href={SITE_TWITTER_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="nebulous.world on Twitter"
            className={ICON_LINK_CLASS}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
          <a
            href={SITE_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="nebulous.world on GitHub"
            className={ICON_LINK_CLASS}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.1 3.29 9.4 7.86 10.94.57.1.78-.25.78-.55 0-.27-.01-1-.02-1.96-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.73-1.56-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 015.8 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.76.12 3.05.74.8 1.19 1.83 1.19 3.09 0 4.43-2.69 5.4-5.25 5.69.42.36.78 1.07.78 2.15 0 1.56-.01 2.81-.01 3.19 0 .3.2.66.79.55A10.51 10.51 0 0023.5 12c0-6.27-5.23-11.5-11.5-11.5z" />
            </svg>
          </a>
        </nav>
      </div>
    </footer>
  );
}
