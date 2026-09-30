"use client";

import dynamic from "next/dynamic";
import { EmbedRoot } from "@/first-party/shared/embed-root";
import { GolfLoading } from "@/first-party/mini-golf/loading";

// three.js and the course only ever load here.
const MiniGolfApp = dynamic(() => import("@/first-party/mini-golf/app").then((m) => m.MiniGolfApp), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh w-full">
      <GolfLoading />
    </div>
  ),
});

export default function MiniGolfPage() {
  return (
    <EmbedRoot slug="mini-golf">
      <MiniGolfApp />
    </EmbedRoot>
  );
}
