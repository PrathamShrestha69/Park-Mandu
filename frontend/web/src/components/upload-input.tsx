"use client";

import { Upload } from "lucide-react";
import { useFormStatus } from "react-dom";

import { buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** File picker that submits its Server Action form immediately after a file is chosen. */
export function UploadInput({ label, accept }: { label: string; accept: string }) {
  const { pending } = useFormStatus();
  return (
    <label
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "relative cursor-pointer has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        pending && "pointer-events-none opacity-60",
      )}
      aria-disabled={pending}
    >
      {pending ? <Spinner /> : <Upload />}
      {pending ? "Uploading…" : label}
      <input
        type="file"
        name="file"
        accept={accept}
        disabled={pending}
        className="absolute inset-0 w-full cursor-pointer opacity-0"
        onChange={(e) => {
          if (e.currentTarget.files?.length) e.currentTarget.form?.requestSubmit();
        }}
      />
    </label>
  );
}
