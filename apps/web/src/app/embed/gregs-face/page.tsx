"use client";

import { GregsFaceApp } from "@/first-party/gregs-face/app";
import { EmbedRoot } from "@/first-party/shared/embed-root";

/** A standalone app: opened directly, the mock host runs it in app mode (you alone, no match). */
export default function GregsFaceEmbed() {
  return (
    <EmbedRoot slug="gregs-face" purpose="app">
      <GregsFaceApp />
    </EmbedRoot>
  );
}
