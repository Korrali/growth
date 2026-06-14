import Link from "next/link";
import { cn } from "@/lib/utils";
import { MobileNav } from "./MobileNav";
import { ProfileMenu } from "./ProfileMenu";

type NavKey =
  | "growth" | "companies" | "contacts" | "campaigns" | "outreach"
  | "inbox" | "calls" | "trials" | "content" | "community" | "linkedin"
  | "seo" | "settings" | "clients";

interface Props {
  orgName: string;
  userEmail: string;
  currentPath?: NavKey;
}

const NAV_ITEMS: { href: string; label: string; key: NavKey }[] = [
  { href: "/growth",           label: "Overview",   key: "growth" },
  { href: "/growth/companies", label: "Companies",  key: "companies" },
  { href: "/growth/contacts",  label: "Contacts",   key: "contacts" },
  { href: "/growth/campaigns", label: "Campaigns",  key: "campaigns" },
  { href: "/growth/outreach",  label: "Outreach",   key: "outreach" },
  { href: "/growth/inbox",     label: "Inbox",      key: "inbox" },
  { href: "/growth/calls",     label: "Calls",      key: "calls" },
  { href: "/growth/trials",    label: "Trials",     key: "trials" },
  { href: "/growth/content",   label: "Content",    key: "content" },
  { href: "/growth/community", label: "Community",  key: "community" },
  { href: "/growth/linkedin",  label: "LinkedIn",   key: "linkedin" },
  { href: "/growth/seo",       label: "SEO",        key: "seo" },
  { href: "/growth/clients",    label: "Clients",    key: "clients" },
  { href: "/growth/settings",  label: "Settings",   key: "settings" },
];

export function AppHeader({ orgName, userEmail, currentPath }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">

        {/* Brand */}
        <Link
          href="/growth"
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight text-foreground"
        >
          <span className="inline-grid h-6 w-6 place-items-center rounded-[6px] bg-accent text-white text-[11px] font-bold">
            K
          </span>
          <span>Growth</span>
        </Link>

        <div className="hidden sm:block h-5 w-px shrink-0 bg-border" aria-hidden />

        <span className="hidden sm:block shrink-0 text-sm text-muted-foreground">
          {orgName}
        </span>

        {/* Desktop nav — flex-1 so it fills remaining space; overflow-x-auto if
            items ever exceed available width at narrower lg viewports */}
        <nav className="hidden lg:flex flex-1 min-w-0 overflow-x-auto items-center gap-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ml-2">
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

        {/* Right — always visible; avatar button replaces inline email */}
        <div className="ml-auto lg:ml-0 flex shrink-0 items-center gap-1">
          <ProfileMenu email={userEmail} orgName={orgName} />
          <MobileNav items={NAV_ITEMS} currentPath={currentPath} />
        </div>
      </div>
    </header>
  );
}
