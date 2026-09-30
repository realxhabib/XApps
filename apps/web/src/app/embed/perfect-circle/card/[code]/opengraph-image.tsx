import { ImageResponse } from "next/og";
import { circleArt, decodeCard } from "@/first-party/perfect-circle/card";
import { accuracyColor, formatAccuracy, verdictFor } from "@/first-party/perfect-circle/logic";
import { getOfficialApp } from "@/platform/catalog";

export const alt = "A circle drawn freehand on XApps, with its accuracy";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The shared circle as a 1200 × 630 card (same layout as the in-app canvas card). */
export default async function PerfectCircleCardImage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const card = decodeCard(code);
  const [from, to] = getOfficialApp("perfect-circle")?.accent ?? ["#ffcf3d", "#34e89e"];
  const board = 540;
  const art = card ? circleArt(card.stroke, board, 72) : null;
  const color = card ? accuracyColor(card.accuracy) : "#f6f7fb";
  const verdict = card ? verdictFor(card.accuracy).word : "Draw a perfect circle";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: 45,
          background: `radial-gradient(circle at 90% 5%, ${from}55 0%, transparent 45%), radial-gradient(circle at 100% 100%, ${to}44 0%, transparent 45%), #05060a`,
          color: "#f6f7fb",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            width: board,
            height: board,
            display: "flex",
            borderRadius: 36,
            background: "#0b0d14",
            border: "2px solid rgba(255,255,255,0.10)",
          }}
        >
          <svg width={board} height={board} viewBox={`0 0 ${board} ${board}`}>
            {art && art.radius > 0 && (
              <circle
                cx={art.center.x}
                cy={art.center.y}
                r={art.radius}
                fill="none"
                stroke="rgba(255,255,255,0.16)"
                strokeWidth={4}
                strokeDasharray="11 13"
              />
            )}
            {art?.segments.map((s, i) => (
              <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={9} strokeLinecap="round" />
            ))}
            <circle cx={board / 2} cy={board / 2} r={11} fill="#f6f7fb" />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 56, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 26, fontWeight: 700, color: "#b8bfcf", letterSpacing: 6 }}>
            <div style={{ width: 26, height: 26, borderRadius: 13, border: "5px solid #ff4d5e", marginRight: 14 }} />
            PERFECT CIRCLE
          </div>
          <div style={{ fontSize: 150, fontWeight: 900, letterSpacing: -6, lineHeight: 1, marginTop: 34, color }}>
            {card ? formatAccuracy(card.accuracy) : "—"}
          </div>
          <div style={{ fontSize: 50, fontWeight: 800, marginTop: 18 }}>{verdict}</div>
          <div style={{ fontSize: 30, color: "#dfe3ec", marginTop: 14 }}>drawn freehand, one stroke</div>
          <div style={{ fontSize: 30, fontWeight: 700, marginTop: 92 }}>Can you beat it?</div>
          <div style={{ fontSize: 24, color: "#8a93a6", marginTop: 8 }}>XApps · draw yours, see where you rank</div>
        </div>
      </div>
    ),
    size,
  );
}
