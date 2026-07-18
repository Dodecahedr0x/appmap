import { ImageResponse } from "next/og";
import { getAppDetail } from "@/lib/queries";
import { formatToken, formatNumber } from "@/lib/utils";
import { SITE_NAME } from "@/lib/constants";

export const alt = "App preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const bgColor = "#1f232e";
const bg = "radial-gradient(circle at 50% 0%, rgba(50, 69, 255, 0.3) 0%, rgba(31, 35, 46, 0) 60%)";
const hairline = "#545864";
const ivory = "#17191e";
const mist = "#0c0f19";
const ink = "#f2f6fa";
const slate = "#858b98";
const violet = "#acafff";
const forest = "#4bf3c8";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = await getAppDetail(slug);

  if (!detail) {
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
      { ...size }
    );
  }

  const { app } = detail;

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
          padding: 72,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          {app.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={app.iconUrl}
              alt=""
              width={144}
              height={144}
              style={{ borderRadius: 32, objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                width: 144,
                height: 144,
                borderRadius: 32,
                background: mist,
                alignItems: "center",
                justifyContent: "center",
                fontSize: 64,
                fontWeight: 800,
                color: violet,
              }}
            >
              {app.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", fontSize: 60, fontWeight: 800, color: ink }}>
              {app.name}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <div
                style={{
                  display: "flex",
                  padding: "6px 18px",
                  borderRadius: 999,
                  border: `1px solid ${hairline}`,
                  background: ivory,
                  fontSize: 24,
                  color: slate,
                  textTransform: "capitalize",
                }}
              >
                {app.category}
              </div>
              <div
                style={{
                  display: "flex",
                  padding: "6px 18px",
                  borderRadius: 999,
                  border: `1px solid ${hairline}`,
                  background: ivory,
                  fontSize: 24,
                  color: slate,
                  textTransform: "capitalize",
                }}
              >
                {app.chain}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 32,
            color: slate,
            maxWidth: 1000,
          }}
        >
          {app.tagline || app.description}
        </div>

        <div style={{ display: "flex", gap: 48, borderTop: `1px solid ${hairline}`, paddingTop: 32 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", fontSize: 22, color: slate }}>Rank score</div>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 700, color: forest }}>
              {app.rankScore.toFixed(2)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", fontSize: 22, color: slate }}>Votes</div>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 700, color: ink }}>
              {formatToken(app.voteWeight, "")}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", fontSize: 22, color: slate }}>Staked</div>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 700, color: ink }}>
              {formatToken(app.stakeTotal, "")}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", fontSize: 22, color: slate }}>Views</div>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 700, color: ink }}>
              {formatNumber(app.viewCount)}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              marginLeft: "auto",
              alignItems: "center",
              fontSize: 28,
              fontWeight: 700,
              color: ink,
            }}
          >
            {SITE_NAME}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
