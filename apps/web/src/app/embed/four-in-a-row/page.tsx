"use client";

import { EmbedRoot } from "@/first-party/shared/embed-root";
import { FourInARowApp } from "@/first-party/four-in-a-row/app";

export default function FourInARowPage() {
  return (
    <EmbedRoot slug="four-in-a-row">
      <FourInARowApp />
    </EmbedRoot>
  );
}
