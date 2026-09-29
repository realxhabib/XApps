"use client";

import dynamic from "next/dynamic";
import { EmbedRoot } from "@/first-party/shared/embed-root";
import { WedgeLoading } from "@/first-party/wedge-wars/loading";

// three.js, the physics engine and the post-processing stack only ever load here.
const WedgeWarsApp = dynamic(() => import("@/first-party/wedge-wars/app").then((m) => m.WedgeWarsApp), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh w-full">
      <WedgeLoading />
    </div>
  ),
});

export default function WedgeWarsPage() {
  return (
    <EmbedRoot slug="wedge-wars">
      <WedgeWarsApp />
    </EmbedRoot>
  );
}
