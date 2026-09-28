"use client";

import { EmojiDecodeApp } from "@/first-party/emoji-decode/app";
import { EmbedRoot } from "@/first-party/shared/embed-root";

export default function EmojiDecodePage() {
  return (
    <EmbedRoot slug="emoji-decode">
      <EmojiDecodeApp />
    </EmbedRoot>
  );
}
