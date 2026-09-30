"use client";

import { Darts } from "@/first-party/darts/app";
import { EmbedRoot } from "@/first-party/shared/embed-root";

export default function DartsEmbed() {
  return (
    <EmbedRoot slug="darts">
      <Darts />
    </EmbedRoot>
  );
}
