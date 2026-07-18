import { ImageResponse } from "next/og";
import { fetchPlatformStats } from "@/lib/indexerClient";
import { formatToken, formatNumber } from "@/lib/utils";
import { TOKEN_SYMBOL, SITE_NAME } from "@/lib/constants";

export const alt = "Explore nebulous.world";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const bgColor = "#1f232e";
const bg = "radial-gradient(circle at 50% 0%, rgba(50, 69, 255, 0.3) 0%, rgba(31, 35, 46, 0) 60%)";
const hairline = "#545864";
const ink = "#f2f6fa";
const slate = "#858b98";
const forest = "#4bf3c8";

export default async function Image() {
  const stats = await fetchPlatformStats().catch(() => null);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: bgColor,
          backgroundImage: bg,
          padding: 80,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 800, color: ink }}>
            Explore {SITE_NAME}
          </div>
          <div style={{ display: "flex", fontSize: 32, color: slate }}>
            Top apps, tag trends, and how apps and tags relate to each other.
          </div>
        </div>

        {stats && (
          <div style={{ display: "flex", gap: 56, borderTop: `1px solid ${hairline}`, paddingTop: 40 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", fontSize: 26, color: slate }}>Apps</div>
              <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: forest }}>
                {formatNumber(stats.totalApps)}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", fontSize: 26, color: slate }}>Tags</div>
              <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: ink }}>
                {formatNumber(stats.totalTags)}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", fontSize: 26, color: slate }}>Total staked</div>
              <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: ink }}>
                {formatToken(stats.totalStake, TOKEN_SYMBOL)}
              </div>
            </div>
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
