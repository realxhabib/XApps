import type { Metadata } from "next";
import { Suspense } from "react";
import { Leaderboard } from "@/components/pages/leaderboard";

export const metadata: Metadata = { title: "Leaderboard" };

export default function LeaderboardPage() {
  return (
    <Suspense>
      <Leaderboard />
    </Suspense>
  );
}
