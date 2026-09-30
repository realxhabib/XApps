"use client";

import dynamic from "next/dynamic";
import { EmbedRoot } from "@/first-party/shared/embed-root";
import { FrontlineLoading } from "@/first-party/frontline/loading";

// three.js only ever loads here.
const FrontlineApp = dynamic(() => import("@/first-party/frontline/app").then((m) => m.FrontlineApp), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh w-full">
      <FrontlineLoading />
    </div>
  ),
});

export default function FrontlinePage() {
  return (
    <EmbedRoot slug="frontline">
      <FrontlineApp />
    </EmbedRoot>
  );
}
