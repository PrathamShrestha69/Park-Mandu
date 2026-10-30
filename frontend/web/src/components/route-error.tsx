"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

import { ErrorState } from "./common";

/** Shared body for error.tsx boundaries: friendly message plus retry. */
export function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const unreachable = error instanceof Error && /unavailable|fetch failed|ECONNREFUSED/i.test(error.message);
  return (
    <div className="mx-auto w-full max-w-2xl pt-10">
      <ErrorState
        title={unreachable ? "Service temporarily unavailable" : "Something went wrong"}
        body={
          unreachable
            ? "We could not reach the Park Mandu service. Check your connection and try again."
            : "This page could not be loaded. Please try again — if the problem continues, contact the help desk."
        }
        action={
          <Button type="button" onClick={() => retry()}>
            <RefreshCw /> Try again
          </Button>
        }
      />
    </div>
  );
}
