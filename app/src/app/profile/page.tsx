import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { XpProgress } from "@/components/profile/XpProgress";
import { SITE_URL } from "@/lib/constants";
import { getSession } from "@/lib/session";

// Reads the session cookie, so it must be rendered per-request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your level, XP, and activity on nebulous.world.",
  alternates: { canonical: `${SITE_URL}/profile` },
};

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Your level and XP reflect how much you've contributed — voting, staking, submitting apps, and suggesting tags. It's cosmetic status only: it never affects vote weight, fees, or ranking."
      />
      <XpProgress />
    </div>
  );
}
