import type { Metadata } from "next";
import { Developers } from "@/components/pages/developers";

export const metadata: Metadata = {
  title: "Build on XApps",
  description: "The XApps SDK: X identity, realtime rooms, matchmaking, crowd judging and host UI for head-to-head apps.",
};

export default function DevelopersPage() {
  return <Developers />;
}
