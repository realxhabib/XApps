import { X_MARK_PATH } from "@/components/ui/x-logo";
import { ImageResponse } from "next/og";

export const alt = "XApps — challenge anyone on X";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social card for the site (no emoji: rendered without network access). */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "radial-gradient(circle at 85% 10%, #5b3cff 0%, transparent 45%), radial-gradient(circle at 10% 100%, #ff3d8b 0%, transparent 40%), #05060a",
          color: "#f6f7fb",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "#000",
              border: "2px solid rgba(255,255,255,0.18)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24">
              <path fill="#fff" d={X_MARK_PATH} />
            </svg>
          </div>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>Apps</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 96, fontWeight: 900, letterSpacing: -4, lineHeight: 1 }}>Challenge anyone</div>
          <div style={{ display: "flex", alignItems: "flex-end", fontSize: 96, fontWeight: 900, letterSpacing: -4, lineHeight: 1, color: "#b9a6ff" }}>
            on
            <svg width="68" height="68" viewBox="0 0 24 24" style={{ marginLeft: 26, marginBottom: 6 }}>
              <path fill="#ffffff" d={X_MARK_PATH} />
            </svg>
            .
          </div>
          <div style={{ marginTop: 28, fontSize: 34, color: "#b8bfcf" }}>
            Reflex duels · meme battles · robot brawls · four in a row
          </div>
        </div>
      </div>
    ),
    size,
  );
}
