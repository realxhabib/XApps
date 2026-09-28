import { Code2, Gavel, Home, LayoutGrid, Swords, Trophy, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shows the inbox badge. */
  inbox?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/apps", label: "Apps", icon: LayoutGrid },
  { href: "/arena", label: "Arena", icon: Gavel },
  { href: "/challenges", label: "Challenges", icon: Swords, inbox: true },
  { href: "/leaderboard", label: "Ranks", icon: Trophy },
  { href: "/developers", label: "Build", icon: Code2 },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
