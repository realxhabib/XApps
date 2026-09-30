"use client";

import { PerfectCircle } from "@/first-party/perfect-circle/app";
import { EmbedRoot } from "@/first-party/shared/embed-root";

export default function PerfectCircleEmbed() {
  return (
    <EmbedRoot slug="perfect-circle">
      <PerfectCircle />
    </EmbedRoot>
  );
}
