import type { Metadata } from "next";
import { PlayRoom } from "@/components/play/play-room";

export const metadata: Metadata = {
  title: "Match",
  description: "You've been challenged on XApps. Accept and play head-to-head.",
};

export default async function PlayPage({ params }: PageProps<"/play/[matchId]">) {
  const { matchId } = await params;
  return <PlayRoom matchId={matchId} />;
}
