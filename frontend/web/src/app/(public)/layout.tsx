import { AppShell } from "@/components/shell";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <AppShell role="public">{children}</AppShell>;
}
