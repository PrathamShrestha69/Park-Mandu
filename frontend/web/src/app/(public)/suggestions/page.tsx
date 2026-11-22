import { MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Badge, PageHead, PageSkeleton, SectionTitle, surface } from "@/components/common";
import { ActionForm, FormAlert, SelectField, SubmitButton, TextAreaField } from "@/components/forms";
import { submitSuggestionAction } from "@/lib/actions/operations";
import { apiGet } from "@/lib/api";
import { SUGGESTION_CATEGORY, SUGGESTION_STATUS, formatDateTime } from "@/lib/format";
import type { Suggestion } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Suggestion box" };

async function MySuggestions() {
  const mine = await apiGet<Suggestion[]>("/suggestions/mine");
  if (!mine.length) return null;
  return (
    <section className="mt-10" aria-labelledby="mine">
      <SectionTitle id="mine" title="Your earlier suggestions" />
      <ul className="flex flex-col gap-2">
        {mine.map((s) => (
          <li key={s.id} className={cn(surface, "p-4")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Badge tone={SUGGESTION_STATUS[s.status].tone}>{SUGGESTION_STATUS[s.status].label}</Badge>
                <Badge>{SUGGESTION_CATEGORY[s.category]}</Badge>
              </span>
              <time dateTime={s.created_at} className="text-xs text-muted-foreground">
                {formatDateTime(s.created_at)}
              </time>
            </div>
            <p className="mt-2 text-sm whitespace-pre-line">{s.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SuggestionsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHead title="Suggestion box" subtitle="Tell the Park Mandu team how parking, traffic or this service could be better." />
      <section className={cn(surface, "p-5 md:p-6")}>
        <div className="mb-5 flex items-start gap-3 text-sm text-muted-foreground">
          <MessagesSquare className="mt-0.5 size-5 shrink-0 text-primary" />
          <p>Every suggestion is read by an administrator. Please don&apos;t include passwords or payment details.</p>
        </div>
        <ActionForm action={submitSuggestionAction}>
          <SelectField
            name="category"
            label="Topic"
            defaultValue="parking"
            options={Object.entries(SUGGESTION_CATEGORY).map(([value, label]) => ({ value, label }))}
          />
          <TextAreaField
            name="message"
            label="Your suggestion"
            required
            rows={6}
            hint="At least 10 characters, up to 1,500."
            placeholder="e.g. Please add motorbike parking near Ratna Park bus stop."
          />
          {/* Spam trap: invisible to people, filled in by bots. */}
          <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden">
            <label>
              Website
              <input type="text" name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <FormAlert />
          <SubmitButton pendingLabel="Sending…">Send suggestion</SubmitButton>
        </ActionForm>
      </section>
      <Suspense fallback={<PageSkeleton cards={1} />}>
        <MySuggestions />
      </Suspense>
    </div>
  );
}
