import {
  Bell,
  Cctv,
  ClipboardList,
  FileText,
  House,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  Siren,
  SquareParking,
  TriangleAlert,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { createDraftAction } from "@/lib/actions/applications";
import { logoutAction } from "@/lib/actions/auth";
import { getUnreadCount, getViewer } from "@/lib/dal";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

import { Brand } from "./common";
import { NavLink } from "./interactive";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  exact?: boolean;
  badge?: "notifications";
}

const NAV: Record<Role, NavItem[]> = {
  public: [
    { href: "/home", label: "Home", icon: <House /> },
    { href: "/explore", label: "Map", icon: <Map /> },
    { href: "/my-parking", label: "My Parking", icon: <SquareParking /> },
    { href: "/notifications", label: "Notifications", icon: <Bell />, badge: "notifications" },
    { href: "/profile", label: "Profile", icon: <User /> },
  ],
  police: [
    { href: "/police", label: "Dashboard", icon: <LayoutDashboard />, exact: true },
    { href: "/police/cameras", label: "Cameras", icon: <Cctv /> },
    { href: "/police/alerts", label: "Alerts", icon: <TriangleAlert /> },
    { href: "/police/incidents", label: "Incidents", icon: <Siren /> },
    { href: "/police/profile", label: "Profile", icon: <User /> },
  ],
  admin: [
    { href: "/admin", label: "Overview", icon: <LayoutDashboard />, exact: true },
    { href: "/admin/applications", label: "Applications", icon: <FileText /> },
    { href: "/admin/map", label: "Map", icon: <Map /> },
    { href: "/admin/users", label: "Users", icon: <Users /> },
    { href: "/admin/more", label: "More", icon: <Menu /> },
  ],
};

const SUBTITLE: Record<Role, string> = {
  public: "Kathmandu Valley",
  police: "Traffic Monitoring",
  admin: "Administration",
};

/** Where the top-bar search sends each role, and what it searches. */
const SEARCH: Record<Role, { action: string; placeholder: string }> = {
  public: { action: "/explore", placeholder: "Search parking, street or area" },
  police: { action: "/police/alerts", placeholder: "Search plate, alert code or road" },
  admin: { action: "/admin/applications", placeholder: "Search reference, applicant or address" },
};

const INBOX: Record<Role, { href: string; label: string }> = {
  public: { href: "/notifications", label: "Notifications" },
  police: { href: "/police/alerts?status=active", label: "Unassigned alerts" },
  admin: { href: "/admin/applications?status=submitted", label: "New applications" },
};

const SIDE_LINK = cn(
  "group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors",
  "hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
  "aria-[current=page]:bg-primary/[0.08] aria-[current=page]:text-primary",
  "[&_svg]:size-4 [&_svg]:shrink-0",
);

const BOTTOM_LINK = cn(
  "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium text-muted-foreground transition-colors",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:text-primary",
  "[&_svg]:size-[22px] [&_svg]:stroke-[1.75] aria-[current=page]:[&_svg]:stroke-[2.25]",
  "before:absolute before:top-0 before:h-0.5 before:w-6 before:rounded-full aria-[current=page]:before:bg-primary",
);

async function UnreadBadge({ variant }: { variant: "side" | "bottom" }) {
  const unread = await getUnreadCount().catch(() => 0);
  if (!unread) return null;
  return variant === "side" ? (
    <span className="ml-auto grid h-5 min-w-5 place-items-center rounded bg-destructive px-1 font-mono text-[11px] font-medium text-white tabular-nums">
      {unread}
    </span>
  ) : (
    <span className="absolute top-1.5 left-[calc(50%+4px)] grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 font-mono text-[10px] font-medium text-white ring-2 ring-background tabular-nums">
      {unread > 9 ? "9+" : unread}
    </span>
  );
}

async function SidebarUser() {
  const user = await getViewer();
  return (
    <div className="flex items-center gap-2.5 rounded-lg border p-2">
      <Avatar className="size-9">
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{user.initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 leading-tight">
        <strong className="block truncate text-sm font-medium">{user.full_name}</strong>
        <small className="block truncate text-xs text-muted-foreground">
          {user.badge_number ? `${user.designation} · ${user.badge_number}` : user.designation}
        </small>
      </div>
      <form action={logoutAction}>
        <Button variant="ghost" size="icon-sm" aria-label="Sign out" className="text-muted-foreground">
          <LogOut />
        </Button>
      </form>
    </div>
  );
}

async function TopBarUser() {
  const user = await getViewer();
  return (
    <span className="flex items-center gap-2.5">
      <Avatar className="size-8">
        <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">{user.initials}</AvatarFallback>
      </Avatar>
      <span className="hidden leading-tight xl:block">
        <strong className="block text-[0.8125rem] font-medium">{user.full_name}</strong>
        <small className="block text-xs text-muted-foreground">{user.designation}</small>
      </span>
    </span>
  );
}

/** The sidebar's main call to action, like "New Project" in a project tool. */
function PrimaryAction({ role }: { role: Role }) {
  if (role === "public")
    return (
      <form action={createDraftAction}>
        <Button type="submit" className="w-full">
          <Plus /> Add parking location
        </Button>
      </form>
    );
  if (role === "admin")
    return (
      <Button asChild className="w-full">
        <Link href="/admin/users/new">
          <UserPlus /> Add staff account
        </Link>
      </Button>
    );
  return (
    <Button asChild className="w-full">
      <Link href="/police/alerts?status=active">
        <TriangleAlert /> Unassigned alerts
      </Link>
    </Button>
  );
}

/**
 * Links with an active state need the current path, which is only known at request time —
 * so they stream in behind <Suspense>; the prerendered fallback is the same links without it.
 */
function NavItems({ items, variant, plain }: { items: NavItem[]; variant: "side" | "bottom"; plain?: boolean }) {
  const className = variant === "side" ? SIDE_LINK : BOTTOM_LINK;
  return items.map((item) => {
    const content = (
      <>
        {item.icon}
        <span>{item.label}</span>
        {item.badge && (
          <Suspense fallback={null}>
            <UnreadBadge variant={variant} />
          </Suspense>
        )}
      </>
    );
    return plain ? (
      <Link key={item.href} href={item.href} className={className}>
        {content}
      </Link>
    ) : (
      <NavLink key={item.href} href={item.href} exact={item.exact} className={className}>
        {content}
      </NavLink>
    );
  });
}

export function AppShell({ role, children }: { role: Role; children: ReactNode }) {
  const items = NAV[role];
  const sideItems: NavItem[] = role === "admin" ? [...items, { href: "/admin/audit", label: "Audit log", icon: <ClipboardList /> }] : items;
  const home = items[0].href;
  const search = SEARCH[role];
  return (
    <div className="min-h-dvh bg-background text-foreground lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-4 lg:flex" aria-label="Main navigation">
        <Link href={home} className="rounded-md px-1.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <Brand subtitle={SUBTITLE[role]} />
        </Link>
        <div className="mt-6">
          <PrimaryAction role={role} />
        </div>
        <p className="mt-6 mb-1.5 px-2.5 text-xs font-medium text-muted-foreground">Menu</p>
        <nav className="flex flex-col gap-0.5">
          <Suspense fallback={<NavItems items={sideItems} variant="side" plain />}>
            <NavItems items={sideItems} variant="side" />
          </Suspense>
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          <p className="flex items-start gap-2 px-2.5 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            Official government service. Data protected under national digital-service standards.
          </p>
          <Suspense fallback={<Skeleton className="h-[54px] rounded-lg" />}>
            <SidebarUser />
          </Suspense>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop top bar: search, inbox, account. */}
        <header className="sticky top-0 z-40 hidden h-14 items-center gap-4 border-b bg-card px-8 lg:flex">
          <form action={search.action} role="search" className="w-full max-w-md">
            <InputGroup className="h-9 bg-background shadow-none">
              <InputGroupInput name="q" placeholder={search.placeholder} aria-label={search.placeholder} autoComplete="off" />
              <InputGroupAddon className="pl-3">
                <Search />
              </InputGroupAddon>
            </InputGroup>
          </form>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="outline" size="icon-sm" className="relative">
              <Link href={INBOX[role].href} aria-label={INBOX[role].label}>
                <Bell />
              </Link>
            </Button>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <Suspense fallback={<Skeleton className="size-8 rounded-full" />}>
              <TopBarUser />
            </Suspense>
          </div>
        </header>

        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-card px-4 lg:hidden">
          <Link href={home} aria-label="Park Mandu home">
            <Brand size="sm" />
          </Link>
          <span className="rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground">{SUBTITLE[role]}</span>
        </header>

        <main id="main" className="flex-1 px-4 pt-6 pb-28 md:px-8 lg:pt-8 lg:pb-16">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex border-t bg-card/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
        aria-label="Main navigation"
      >
        <Suspense fallback={<NavItems items={items} variant="bottom" plain />}>
          <NavItems items={items} variant="bottom" />
        </Suspense>
      </nav>
    </div>
  );
}
