import { Building2, Check, FileText, IdCard, MessageSquare, Phone, Ruler, ShieldCheck, SquareParking, Trash2, User, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OwnerSummary, PropertySummary, documentUrl } from "@/components/application-view";
import { Callout, PageHead, PageSkeleton, surface } from "@/components/common";
import { ActionForm, CheckField, FormAlert, SelectField, SubmitButton, TextField } from "@/components/forms";
import { LocationPicker } from "@/components/map/location-picker";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { UploadInput } from "@/components/upload-input";
import {
  deleteDocumentAction,
  saveLocationAction,
  saveOwnerAction,
  savePropertyAction,
  submitApplicationAction,
  uploadDocumentAction,
} from "@/lib/actions/applications";
import { apiGet } from "@/lib/api";
import { DAYS_LABEL, DOCUMENT_LABEL, PARKING_TYPE_LABEL, formatBytes } from "@/lib/format";
import type { ApplicationDetail, DocumentKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Add parking location" };

const STEPS = [
  { key: "location", label: "Location", title: "Add parking location", subtitle: "Step 1 of 5 · Location" },
  { key: "property", label: "Property", title: "Property details", subtitle: "Step 2 of 5 · Tell us about the site" },
  { key: "owner", label: "Owner", title: "Owner information", subtitle: "Step 3 of 5 · Verify ownership" },
  { key: "documents", label: "Documents", title: "Supporting documents", subtitle: "Step 4 of 5 · Upload clear copies" },
  { key: "review", label: "Review", title: "Review application", subtitle: "Step 5 of 5 · Confirm your details" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const formClass = "flex flex-col gap-5";

function Stepper({ app, current }: { app: ApplicationDetail; current: number }) {
  return (
    <nav aria-label="Application steps" className="mb-8">
      <ol className="grid grid-cols-5 gap-1.5">
        {STEPS.map((step, index) => {
          const done = index < current && (index < app.completed_step || (index === 3 && !app.missing.some((m) => m.startsWith("document:"))));
          const reachable = index <= Math.max(app.completed_step, current);
          const isCurrent = index === current;
          const content = (
            <>
              <span
                className={cn(
                  "h-1 w-full rounded-full bg-border transition-colors",
                  done && !isCurrent && "bg-success",
                  isCurrent && "bg-foreground",
                )}
              />
              <span
                className={cn(
                  "mt-2 flex items-center gap-1 text-xs text-muted-foreground",
                  isCurrent && "font-semibold text-foreground",
                  done && !isCurrent && "text-success-ink",
                )}
              >
                {done && !isCurrent ? <Check className="size-3 shrink-0" strokeWidth={3} /> : <span className="font-mono">{index + 1}</span>}
                <span className="hidden truncate sm:inline">{step.label}</span>
              </span>
            </>
          );
          return (
            <li key={step.key}>
              {reachable ? (
                <Link
                  href={`/my-parking/${app.id}/edit/${step.key}`}
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={`Step ${index + 1}: ${step.label}`}
                  className="block rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {content}
                </Link>
              ) : (
                <span className="block opacity-60" aria-label={`Step ${index + 1}: ${step.label}`}>
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepActions({ back, children }: { back: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 grid grid-cols-[auto_1fr] gap-2">
      <Button asChild variant="outline" size="lg">
        <Link href={back}>Back</Link>
      </Button>
      {children}
    </div>
  );
}

function LocationStep({ app }: { app: ApplicationDetail }) {
  return (
    <ActionForm action={saveLocationAction} className={formClass}>
      <input type="hidden" name="application_id" value={app.id} />
      <LocationPicker
        initial={app.latitude !== null && app.longitude !== null ? { latitude: app.latitude, longitude: app.longitude } : null}
        initialAddress={app.address}
        initialArea={app.area}
      />
      <FormAlert />
      <SubmitButton pendingLabel="Saving…">Continue</SubmitButton>
    </ActionForm>
  );
}

const choiceClass = cn(
  "flex h-12 cursor-pointer items-center gap-3 rounded-lg border bg-card px-4 text-sm font-medium transition-colors",
  "hover:border-foreground/25 has-checked:border-foreground has-checked:ring-1 has-checked:ring-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring",
);
const radioClass = "size-4 shrink-0 appearance-none rounded-full border-2 border-input bg-card transition-[border] checked:border-[5px] checked:border-foreground";

function PropertyStep({ app }: { app: ApplicationDetail }) {
  return (
    <ActionForm action={savePropertyAction} className={cn(formClass, "pricing-form")}>
      <input type="hidden" name="application_id" value={app.id} />
      <TextField name="property_name" label="Property / parking name" icon={<SquareParking />} defaultValue={app.property_name} placeholder="e.g. Sharma Family Parking" required />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField name="land_size_sqm" label="Land size (m²)" type="number" inputMode="numeric" icon={<Ruler />} defaultValue={app.land_size_sqm} placeholder="680" min={10} />
        <TextField name="capacity" label="Vehicle capacity" type="number" inputMode="numeric" defaultValue={app.capacity} placeholder="18" min={1} required />
      </div>
      <SelectField
        name="parking_type"
        label="Parking type"
        icon={<Building2 />}
        defaultValue={app.parking_type ?? ""}
        placeholder="Select type"
        options={Object.entries(PARKING_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
      />
      <div className="grid grid-cols-2 gap-5">
        <TextField name="opens_at" label="Opens at" type="time" defaultValue={app.opens_at?.slice(0, 5) ?? "07:00"} />
        <TextField name="closes_at" label="Closes at" type="time" defaultValue={app.closes_at?.slice(0, 5) ?? "21:00"} />
      </div>
      <SelectField
        name="available_days"
        label="Available days"
        defaultValue={app.available_days ?? "every_day"}
        options={Object.entries(DAYS_LABEL).map(([value, label]) => ({ value, label }))}
      />
      <FieldSet className="gap-2">
        <FieldLegend variant="label" className="mb-0">
          Pricing
        </FieldLegend>
        <div className="grid grid-cols-2 gap-2">
          <label className={choiceClass}>
            <input type="radio" name="pricing_mode" value="hourly" defaultChecked={app.pricing_mode !== "free"} className={radioClass} />
            Hourly paid
          </label>
          <label className={choiceClass}>
            <input type="radio" name="pricing_mode" value="free" defaultChecked={app.pricing_mode === "free"} className={radioClass} />
            Free parking
          </label>
        </div>
      </FieldSet>
      <div className="price-field">
        <TextField
          name="price_per_hour"
          label="Price per hour (NPR)"
          type="number"
          inputMode="decimal"
          icon={<Wallet />}
          defaultValue={app.price_per_hour ? Number(app.price_per_hour).toFixed(0) : ""}
          placeholder="40"
          min={0}
          hint="Kathmandu Metropolitan City guidance for private lots is NPR 20–60 per hour."
        />
      </div>
      <FormAlert />
      <StepActions back={`/my-parking/${app.id}/edit/location`}>
        <SubmitButton pendingLabel="Saving…">Continue</SubmitButton>
      </StepActions>
    </ActionForm>
  );
}

function OwnerStep({ app }: { app: ApplicationDetail }) {
  return (
    <ActionForm action={saveOwnerAction} className={formClass}>
      <input type="hidden" name="application_id" value={app.id} />
      <Callout icon={<ShieldCheck />} title="Your information is protected">
        ID numbers are encrypted and used only for government verification. Only the last four digits are ever displayed.
      </Callout>
      <TextField name="owner_name" label="Legal owner name" icon={<User />} defaultValue={app.owner_name} placeholder="Full name as on your ID" autoComplete="name" required />
      <TextField name="owner_phone" label="Phone number" type="tel" inputMode="tel" icon={<Phone />} defaultValue={app.owner_phone} placeholder="98XXXXXXXX" autoComplete="tel" required />
      <TextField
        name="government_id"
        label="Government ID number"
        icon={<IdCard />}
        placeholder={app.gov_id_masked ? `Saved (${app.gov_id_masked}) — re-enter to confirm` : "Citizenship / national ID number"}
        autoComplete="off"
        hint="e.g. 27-01-75-12345"
        required
      />
      <TextField
        name="ownership_document_number"
        label="Property ownership / document number"
        icon={<FileText />}
        defaultValue={app.ownership_document_number}
        placeholder="Lalpurja number"
        required
      />
      <CheckField name="owner_confirmed" defaultChecked={app.owner_confirmed}>
        I am the legal owner or an authorised representative of this property.
      </CheckField>
      <FormAlert />
      <StepActions back={`/my-parking/${app.id}/edit/property`}>
        <SubmitButton pendingLabel="Saving…">Continue</SubmitButton>
      </StepActions>
    </ActionForm>
  );
}

const KINDS: DocumentKind[] = ["ownership_document", "government_id", "property_photo", "parking_photo"];

function DocumentsStep({ app }: { app: ApplicationDetail }) {
  const missingDocs = app.missing.filter((m) => m.startsWith("document:"));
  return (
    <div className="flex flex-col gap-3">
      <Callout icon={<FileText />}>
        Accepted formats: JPG, PNG, WEBP or PDF, up to 10 MB each. Photos must be JPG, PNG or WEBP. Location data is removed from photos
        automatically.
      </Callout>
      {KINDS.map((kind) => {
        const files = app.documents.filter((d) => d.kind === kind);
        const meta = DOCUMENT_LABEL[kind];
        const photo = kind === "property_photo" || kind === "parking_photo";
        const done = files.length > 0;
        return (
          <section
            key={kind}
            className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", done ? "border-success/30" : "border-dashed border-input")}
            aria-label={meta.title}
          >
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-lg [&_svg]:size-[18px]",
                  done ? "bg-success text-white" : "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check /> : <FileText />}
              </span>
              <div className="min-w-0 flex-1">
                <strong className="block text-sm font-semibold">
                  {meta.title} {!meta.required && <span className="font-normal text-muted-foreground">(optional)</span>}
                </strong>
                <small className="block text-xs text-muted-foreground">
                  {done ? `${files.length} file${files.length > 1 ? "s" : ""} uploaded` : meta.hint}
                </small>
              </div>
            </div>
            {done && (
              <ul className="flex flex-col gap-1.5">
                {files.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-3 rounded-lg bg-muted/60 p-1.5 pr-2">
                    {doc.has_thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={documentUrl(doc.id, "thumbnail")} alt="" className="size-9 shrink-0 rounded-md object-cover" />
                    ) : (
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-card text-muted-foreground">
                        <FileText className="size-4" />
                      </span>
                    )}
                    <a className="min-w-0 flex-1 hover:underline" href={documentUrl(doc.id)} target="_blank" rel="noopener noreferrer">
                      <strong className="block truncate text-[0.8125rem] font-medium">{doc.original_name}</strong>
                      <small className="text-xs text-muted-foreground">
                        {formatBytes(doc.size_bytes)} · {doc.status === "processing" ? "Processing…" : doc.status === "failed" ? "Unreadable" : "Ready"}
                      </small>
                    </a>
                    <form action={deleteDocumentAction}>
                      <input type="hidden" name="application_id" value={app.id} />
                      <input type="hidden" name="document_id" value={doc.id} />
                      <Button type="submit" variant="ghost" size="icon-sm" aria-label={`Remove ${doc.original_name}`} className="text-muted-foreground hover:text-destructive">
                        <Trash2 />
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={uploadDocumentAction} className="flex flex-col items-start gap-2">
              <input type="hidden" name="application_id" value={app.id} />
              <input type="hidden" name="kind" value={kind} />
              <UploadInput label={done ? "Add another" : "Upload file"} accept={photo ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,application/pdf"} />
              <FormAlert />
            </ActionForm>
          </section>
        );
      })}
      <StepActions back={`/my-parking/${app.id}/edit/owner`}>
        {missingDocs.length ? (
          <Button size="lg" disabled title="Upload the required documents first">
            Continue
          </Button>
        ) : (
          <Button asChild size="lg">
            <Link href={`/my-parking/${app.id}/edit/review`}>Continue</Link>
          </Button>
        )}
      </StepActions>
      {missingDocs.length > 0 && <p className="text-center text-xs text-muted-foreground">Upload the required documents to continue.</p>}
    </div>
  );
}

const MISSING_LABEL: Record<string, { label: string; step: StepKey }> = {
  location: { label: "Location on the map", step: "location" },
  property: { label: "Property details", step: "property" },
  owner: { label: "Owner information", step: "owner" },
  "document:ownership_document": { label: "Land ownership document", step: "documents" },
  "document:government_id": { label: "Government ID", step: "documents" },
  "document:property_photo": { label: "Property photos", step: "documents" },
};

function EditLink({ href }: { href: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={href}>Edit</Link>
    </Button>
  );
}

function ReviewStep({ app }: { app: ApplicationDetail }) {
  const docCount = app.documents.length;
  return (
    <div className="flex flex-col gap-3">
      {app.status === "changes_requested" && app.feedback && (
        <Callout tone="danger" icon={<MessageSquare />} title="Requested by the review team">
          {app.feedback}
        </Callout>
      )}
      {app.missing.length > 0 && (
        <Callout tone="warning" title="Complete these before submitting">
          <ul className="mt-1 list-disc pl-4">
            {app.missing.map((m) => (
              <li key={m}>
                <Link href={`/my-parking/${app.id}/edit/${MISSING_LABEL[m]?.step ?? "location"}`} className="underline underline-offset-4">
                  {MISSING_LABEL[m]?.label ?? m}
                </Link>
              </li>
            ))}
          </ul>
        </Callout>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="font-semibold">Location & property</CardTitle>
          <CardAction>
            <EditLink href={`/my-parking/${app.id}/edit/property`} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <PropertySummary app={app} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="font-semibold">Owner & documents</CardTitle>
          <CardAction>
            <EditLink href={`/my-parking/${app.id}/edit/owner`} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <OwnerSummary app={app} />
          <div className="flex items-baseline justify-between gap-6 border-t border-dashed pt-2.5 text-sm">
            <span className="text-muted-foreground">Documents</span>
            <Link href={`/my-parking/${app.id}/edit/documents`} className="font-medium underline underline-offset-4">
              {docCount} uploaded
            </Link>
          </div>
        </CardContent>
      </Card>
      <ActionForm action={submitApplicationAction} className={cn(formClass, "mt-2")}>
        <input type="hidden" name="application_id" value={app.id} />
        <CheckField name="declaration">
          I declare that this information is accurate and consent to government review and site verification. I understand that false
          information may lead to rejection and legal action.
        </CheckField>
        <FormAlert />
        <SubmitButton pendingLabel="Submitting…" icon={<ShieldCheck />}>
          {app.status === "changes_requested" ? "Resubmit for government approval" : "Submit for government approval"}
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

async function EditStepPageContent(props: PageProps<"/my-parking/[id]/edit/[step]">) {
  const { id, step } = await props.params;
  const index = STEPS.findIndex((s) => s.key === step);
  if (index < 0) notFound();
  const app = await apiGet<ApplicationDetail>(`/applications/${id}`);
  if (app.status !== "draft" && app.status !== "changes_requested") redirect(`/my-parking/${id}`);
  const meta = STEPS[index];

  return (
    <div className="w-full max-w-3xl">
      <PageHead title={meta.title} subtitle={meta.subtitle} back={index === 0 ? "/my-parking" : `/my-parking/${id}/edit/${STEPS[index - 1].key}`} />
      <Stepper app={app} current={index} />
      <div className={cn(meta.key === "property" || meta.key === "owner" ? cn(surface, "p-5") : undefined)}>
        {meta.key === "location" && <LocationStep app={app} />}
        {meta.key === "property" && <PropertyStep app={app} />}
        {meta.key === "owner" && <OwnerStep app={app} />}
        {meta.key === "documents" && <DocumentsStep app={app} />}
        {meta.key === "review" && <ReviewStep app={app} />}
      </div>
    </div>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function EditStepPage(props: PageProps<"/my-parking/[id]/edit/[step]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditStepPageContent {...props} />
    </Suspense>
  );
}
