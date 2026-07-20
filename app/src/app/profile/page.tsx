import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { XpProgress } from "@/components/profile/XpProgress";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your level, XP, and activity on nebulous.world.",
  alternates: { canonical: `${SITE_URL}/profile` },
};

export default function ProfilePage() {
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
