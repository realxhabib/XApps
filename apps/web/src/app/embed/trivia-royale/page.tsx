"use client";

import { EmbedRoot } from "@/first-party/shared/embed-root";
import { TriviaRoyaleApp } from "@/first-party/trivia-royale/app";

export default function TriviaRoyalePage() {
  return (
    <EmbedRoot slug="trivia-royale">
      <TriviaRoyaleApp />
    </EmbedRoot>
  );
}
