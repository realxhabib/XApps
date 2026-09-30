"use client";

import { EmbedRoot } from "@/first-party/shared/embed-root";
import { EightBallApp } from "@/first-party/eight-ball/app";

export default function EightBallPage() {
  return (
    <EmbedRoot slug="eight-ball">
      <EightBallApp />
    </EmbedRoot>
  );
}
