"use client";

import { GregsFaceApp } from "@/first-party/gregs-face/app";
import { EmbedRoot } from "@/first-party/shared/embed-root";

export default function GregsFaceEmbed() {
  return (
    <EmbedRoot slug="gregs-face">
      <GregsFaceApp />
    </EmbedRoot>
  );
}
