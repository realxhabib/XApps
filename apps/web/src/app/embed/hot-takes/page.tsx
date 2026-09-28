"use client";

import { HotTakesApp } from "@/first-party/hot-takes/app";
import { EmbedRoot } from "@/first-party/shared/embed-root";

export default function HotTakesEmbed() {
  return (
    <EmbedRoot slug="hot-takes">
      <HotTakesApp />
    </EmbedRoot>
  );
}
