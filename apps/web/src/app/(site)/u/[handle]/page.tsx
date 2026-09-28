import type { Metadata } from "next";
import { ProfileView } from "@/components/pages/profile";

export async function generateMetadata({ params }: PageProps<"/u/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  return { title: `@${handle}`, description: `@${handle}'s XApps profile — wins, streaks and rivalries.` };
}

export default async function ProfilePage({ params }: PageProps<"/u/[handle]">) {
  const { handle } = await params;
  return <ProfileView handle={decodeURIComponent(handle)} />;
}
