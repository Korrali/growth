import Link from "next/link";
import { LogOut } from "lucide-react";
import { signOutAction } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

type NavKey = "growth" | "companies" | "contacts" | "campaigns" | "outreach" | "inbox" | "calls" | "trials" | "content" | "settings";

interface Props {
  orgName: string;
  userEmail: string;
  currentPath?: NavKey;
}

const NAV_ITEMS: { href: string; label: string; key: NavKey }[] = [
  { href: "/growth", label: "Overview", key: "growth" },
  { href: "/growth/companies", label: "Companies", key: "companies" },
  { href: "/growth/contacts", label: "Contacts", key: "contacts" },
  { href: "/growth/campaigns", label: "Campaigns", key: "campaigns" },
  { href: "/growth/outreach", label: "Outreach", key: "outreach" },
  { href: "/growth/inbox", label: "Inbox", key: "inbox" },
  { href: "/growth/calls", label: "Calls", key: "calls" },
  { href: "/growth/trials", label: "Trials", key: "trials" },
  { href: "/growth/content", label: "Content", key: "content" },
  { href: "/growth/settings", label: "Settings", key: "settings" },
];

export function AppHeader({ orgName, userEmail, currentPath }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-6">
        <Link
          href="/growth"
          className="flex items-center gap-2 font-semibold tracking-tight text-foreground"
        >
          <span className="inline-grid h-6 w-6 place-items-center rounded-[6px] bg-accent text-white text-[11px] font-bold">
            K
          </span>
          <span>Growth</span>
        </Link>

        <div className="h-5 w-px bg-border" aria-hidden />

        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span>{orgName}</span>
        </div>

        <nav className="ml-2 hidden lg:flex items-center gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = currentPath === item.key;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden sm:inline text-xs text-muted-foreground">
            {userEmail}
          </span>
          <form action={signOutAction}>
            <button
              type="submit"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
