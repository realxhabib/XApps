"use client";

import { EmbedRoot } from "@/first-party/shared/embed-root";
import { MemeDuelApp } from "@/first-party/meme-duel/app";

export default function MemeDuelPage() {
  return (
    <EmbedRoot slug="meme-duel">
      <MemeDuelApp />
    </EmbedRoot>
  );
}
