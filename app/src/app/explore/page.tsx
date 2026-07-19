import { permanentRedirect } from "next/navigation";

// /explore is now /rankings — see docs/plans/2026-07-19-light-redesign-design.md.
// permanentRedirect (308) so search engines transfer ranking signal to the
// new URL instead of indexing both as separate pages.
export default function ExploreRedirect() {
  permanentRedirect("/rankings");
}
