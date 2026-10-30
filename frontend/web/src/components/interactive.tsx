"use client";

import { Check, Copy, LocateFixed } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog as UiDialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { FLASH_COOKIE } from "@/lib/session";
import { cn } from "@/lib/utils";

/** Navigation link that marks itself as the current page. */
export function NavLink({
  href,
  children,
  exact = false,
  className,
}: {
  href: string;
  children: ReactNode;
  exact?: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className={className} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}

/** Shows one-shot messages that Server Actions leave in a short-lived cookie. */
export function FlashToaster() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    const raw = document.cookie.split("; ").find((c) => c.startsWith(`${FLASH_COOKIE}=`));
    if (!raw) return;
    document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=/`;
    try {
      const { message, tone } = JSON.parse(decodeURIComponent(raw.slice(FLASH_COOKIE.length + 1)));
      if (tone === "error") toast.error(message);
      else if (tone === "info") toast(message);
      else toast.success(message);
    } catch {
      /* ignore malformed flash */
    }
  }, [pathname, searchParams]);
  return null;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** Submits the surrounding GET filter form as soon as a control changes. */
export function AutoSubmitSelect({ className, ...props }: ComponentProps<typeof NativeSelect>) {
  return <NativeSelect {...props} className={className} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

/** Lets forms inside a <Dialog> close it after a successful Server Action. */
export const DialogContext = createContext<{ close: () => void } | null>(null);

type ButtonVariant = ComponentProps<typeof Button>["variant"];

/** Button that opens a modal; the content is usually a Server Action form. */
export function Dialog({
  trigger,
  triggerVariant = "outline",
  triggerClassName,
  icon,
  iconClassName,
  title,
  description,
  children,
}: {
  trigger: ReactNode;
  triggerVariant?: ButtonVariant;
  triggerClassName?: string;
  icon?: ReactNode;
  iconClassName?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <UiDialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={triggerVariant} size="lg" className={cn("w-full", triggerClassName)}>
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-5 p-6 sm:max-w-md">
        <DialogHeader className="gap-2">
          {icon && (
            <span className={cn("mb-2 grid size-10 place-items-center rounded-xl bg-muted [&_svg]:size-5", iconClassName)}>{icon}</span>
          )}
          <DialogTitle className="font-heading text-xl font-semibold tracking-tight">{title}</DialogTitle>
          {description && <DialogDescription className="text-pretty">{description}</DialogDescription>}
        </DialogHeader>
        <DialogContext value={{ close: () => setOpen(false) }}>{children}</DialogContext>
      </DialogContent>
    </UiDialog>
  );
}

/**
 * Asks the browser for the user's position and puts it in the URL (?lat=&lng=), so the server
 * can sort parking by distance. Auto-runs when location permission was already granted.
 */
export function LocateMe({ className, label = "Use my location" }: { className?: string; label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);

  const locate = () => {
    if (!navigator.geolocation) {
      toast.error("Location is not available on this device.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("lat", pos.coords.latitude.toFixed(5));
        params.set("lng", pos.coords.longitude.toFixed(5));
        params.delete("page");
        router.replace(`${pathname}?${params}`, { scroll: false });
        setBusy(false);
      },
      () => {
        setBusy(false);
        toast.error("We couldn't get your location. Showing parking around central Kathmandu.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  };

  useEffect(() => {
    if (searchParams.has("lat")) return;
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((p) => p.state === "granted" && locate())
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Button type="button" variant="outline" size="sm" className={className} onClick={locate} disabled={busy}>
      {busy ? <Spinner /> : <LocateFixed />}
      {busy ? "Locating…" : label}
    </Button>
  );
}
