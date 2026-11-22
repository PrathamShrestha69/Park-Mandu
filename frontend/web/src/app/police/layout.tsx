import { AppShell } from "@/components/shell";

export default function PoliceLayout({ children }: { children: React.ReactNode }) {
  return <AppShell role="police">{children}</AppShell>;
}
