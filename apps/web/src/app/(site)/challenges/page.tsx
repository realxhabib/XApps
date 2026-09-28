import type { Metadata } from "next";
import { Challenges } from "@/components/pages/challenges";

export const metadata: Metadata = { title: "Challenges" };

export default function ChallengesPage() {
  return <Challenges />;
}
