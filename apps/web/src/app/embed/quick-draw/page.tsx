"use client";

import { QuickDraw } from "@/first-party/quick-draw/app";
import { EmbedRoot } from "@/first-party/shared/embed-root";

export default function QuickDrawEmbed() {
  return (
    <EmbedRoot slug="quick-draw">
      <QuickDraw />
    </EmbedRoot>
  );
}
