"use client";

import { PerfectCircle } from "@/first-party/perfect-circle/app";
import { EmbedRoot } from "@/first-party/shared/embed-root";

/** A standalone app: opened directly, the mock host runs it in app mode (you alone, no match). */
export default function PerfectCircleEmbed() {
  return (
    <EmbedRoot slug="perfect-circle" purpose="app">
      <PerfectCircle />
    </EmbedRoot>
  );
}
