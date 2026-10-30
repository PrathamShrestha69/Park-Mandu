import { MapPinOff } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-xl place-items-center px-4 py-20" id="main">
      <EmptyState
        icon={<MapPinOff />}
        title="We couldn't find that page"
        body="The link may be out of date, or you may not have access to this record."
        action={
          <Button asChild>
            <Link href="/">Go to Park Mandu</Link>
          </Button>
        }
      />
    </main>
  );
}
