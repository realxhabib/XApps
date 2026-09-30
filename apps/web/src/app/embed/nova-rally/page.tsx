"use client";

import dynamic from "next/dynamic";
import { EmbedRoot } from "@/first-party/shared/embed-root";
import { RallyLoading } from "@/first-party/nova-rally/loading";

// three.js, the ships and the tracks only ever load here.
const NovaRallyApp = dynamic(() => import("@/first-party/nova-rally/app").then((m) => m.NovaRallyApp), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh w-full bg-[#07051a]">
      <RallyLoading />
    </div>
  ),
});

export default function NovaRallyPage() {
  return (
    <EmbedRoot slug="nova-rally">
      <NovaRallyApp />
    </EmbedRoot>
  );
}
