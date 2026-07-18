import { ImageResponse } from "next/og";
import { fetchTagBySlug } from "@/lib/indexerClient";
import { formatToken, formatNumber } from "@/lib/utils";
import { TOKEN_SYMBOL, SITE_NAME } from "@/lib/constants";

export const alt = "Tag preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const bgColor = "#1f232e";
const bg = "radial-gradient(circle at 50% 0%, rgba(50, 69, 255, 0.3) 0%, rgba(31, 35, 46, 0) 60%)";
const hairline = "#545864";
const ink = "#f2f6fa";
const slate = "#858b98";
const forest = "#4bf3c8";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tag = await fetchTagBySlug(slug);

  if (!tag) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: bgColor,
            backgroundImage: bg,
            color: ink,
            fontSize: 56,
            fontWeight: 700,
          }}
        >
          {SITE_NAME}
        </div>
      ),
      { ...size },
    );
  }

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
        <div style={{ display: "flex", fontSize: 80, fontWeight: 800, color: ink }}>
          #{tag.name}
        </div>

        <div style={{ display: "flex", gap: 56, borderTop: `1px solid ${hairline}`, paddingTop: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", fontSize: 26, color: slate }}>Apps</div>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: forest }}>
              {formatNumber(tag.appCount)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", fontSize: 26, color: slate }}>Total staked</div>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: ink }}>
              {formatToken(tag.stakeTotal, TOKEN_SYMBOL)}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              marginLeft: "auto",
              alignItems: "center",
              fontSize: 32,
              fontWeight: 700,
              color: ink,
            }}
          >
            {SITE_NAME}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
