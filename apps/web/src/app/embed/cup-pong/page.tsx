"use client";

import dynamic from "next/dynamic";
import { EmbedRoot } from "@/first-party/shared/embed-root";
import { CupPongLoading } from "@/first-party/cup-pong/loading";

// three.js only ever loads here.
const CupPongApp = dynamic(() => import("@/first-party/cup-pong/app").then((m) => m.CupPongApp), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh w-full">
      <CupPongLoading />
    </div>
  ),
});

export default function CupPongPage() {
  return (
    <EmbedRoot slug="cup-pong">
      <CupPongApp />
    </EmbedRoot>
  );
}
