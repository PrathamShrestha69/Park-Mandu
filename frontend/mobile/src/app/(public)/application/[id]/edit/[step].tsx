import { useMutation } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { Check, FileText, IdCard, LocateFixed, MapPin, Phone, Search, ShieldCheck, Trash2, Upload, User } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Alert, Pressable, StyleSheet, Switch, TextInput, View } from "react-native";

import { MapView } from "@/components/map-view";
import { DocumentList, OwnerSummary, PropertySummary, WIZARD_STEPS, documentUrl } from "@/components/parking";
import { Button, Callout, Card, Chips, ErrorView, Field, FormMessage, Header, Loading, Row, Screen, Txt } from "@/components/ui";
import { api, authHeaders, formErrors } from "@/lib/api";
import { DAYS_LABEL, DOCUMENT_LABEL, PARKING_TYPE_LABEL, formatBytes } from "@/lib/format";
import { useMyLocation } from "@/lib/location";
import { invalidate, queryClient, useApi } from "@/lib/queries";
import { colors, fonts } from "@/lib/theme";
import type { ApplicationDetail, AvailableDays, DocumentKind, ParkingType, PricingMode } from "@/lib/types";

type Step = (typeof WIZARD_STEPS)[number];
const TITLES: Record<Step, [string, string]> = {
  location: ["Add parking location", "Step 1 of 5 · Location"],
  property: ["Property details", "Step 2 of 5 · Tell us about the site"],
  owner: ["Owner information", "Step 3 of 5 · Verify ownership"],
  documents: ["Supporting documents", "Step 4 of 5 · Upload clear copies"],
  review: ["Review application", "Step 5 of 5 · Confirm your details"],
};

interface Place {
  label: string;
  area: string | null;
  latitude: number;
  longitude: number;
}

function useSave(app: ApplicationDetail, next: string) {
  return useMutation({
    mutationFn: ({ path, json }: { path: string; json: unknown }) => api<ApplicationDetail>(`/applications/${app.id}/${path}`, { method: "PUT", json }),
    onSuccess: (updated) => {
      queryClient.setQueryData([`/applications/${app.id}`, {}], updated);
      void invalidate("/applications/mine");
      router.replace(next as never);
    },
  });
}

function Stepper({ current, app }: { current: number; app: ApplicationDetail }) {
  return (
    <View style={styles.stepper}>
      <View style={styles.stepLine} />
      {WIZARD_STEPS.map((step, i) => {
        const done = i < current && i < Math.max(app.completed_step, current);
        const active = i === current;
        return (
          <Pressable
            key={step}
            style={{ alignItems: "center", width: "20%", gap: 5 }}
            disabled={i > Math.max(app.completed_step, current)}
            onPress={() => router.replace(`/application/${app.id}/edit/${step}` as never)}
            accessibilityRole="button"
            accessibilityLabel={`Step ${i + 1}: ${step}`}
            accessibilityState={{ selected: active }}
          >
            <View style={[styles.stepNum, done && { backgroundColor: colors.green500, borderColor: colors.green500 }, active && { backgroundColor: colors.blue600, borderColor: colors.blue600 }]}>
              {done ? <Check size={13} color="white" /> : <Txt variant="label" color={active ? "white" : colors.slate500}>{i + 1}</Txt>}
            </View>
            <Txt variant="small" color={active ? colors.blue700 : done ? colors.green700 : colors.slate500} style={{ fontSize: 11 }}>
              {step[0].toUpperCase() + step.slice(1)}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// --------------------------------------------------------------------------- step 1

function LocationStep({ app }: { app: ApplicationDetail }) {
  const [pin, setPin] = useState(app.latitude !== null && app.longitude !== null ? { latitude: app.latitude, longitude: app.longitude! } : null);
  const [address, setAddress] = useState(app.address ?? "");
  const [area, setArea] = useState(app.area ?? "");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const { locate, busy } = useMyLocation(false);
  const save = useSave(app, `/application/${app.id}/edit/property`);
  const error = save.error ? formErrors(save.error) : null;

  const lookup = async (coords: { latitude: number; longitude: number }) => {
    setPin(coords);
    const place = await api<Place | null>("/geo/reverse", { query: { lat: coords.latitude, lng: coords.longitude } }).catch(() => null);
    if (place) {
      setAddress(place.label);
      if (place.area) setArea(place.area);
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <Card style={{ paddingVertical: 4 }}>
        <Row>
          <Search size={18} color={colors.slate500} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search a landmark, tole or street"
            placeholderTextColor={colors.slate500}
            returnKeyType="search"
            onSubmitEditing={async () => setResults(await api<Place[]>("/geo/search", { query: { q } }).catch(() => []))}
            style={{ flex: 1, height: 44, fontFamily: fonts.body, fontSize: 15, color: colors.slate950 }}
            accessibilityLabel="Search for a place"
          />
        </Row>
      </Card>
      {results.map((r) => (
        <Card
          key={`${r.latitude},${r.longitude}`}
          onPress={() => {
            setResults([]);
            setPin({ latitude: r.latitude, longitude: r.longitude });
            setAddress(r.label);
            if (r.area) setArea(r.area);
          }}
          style={{ padding: 12 }}
        >
          <Row>
            <MapPin size={16} color={colors.blue600} />
            <Txt variant="body" style={{ flex: 1 }}>
              {r.label}
            </Txt>
          </Row>
        </Card>
      ))}
      <MapView height={300} points={[]} pin={pin} center={pin ?? undefined} onPick={(c) => void lookup(c)} />
      <Txt variant="small" style={{ textAlign: "center" }}>
        Tap the map or drag the pin to the parking entrance
      </Txt>
      <Button
        title={busy ? "Locating…" : "Use current location"}
        variant="secondary"
        icon={<LocateFixed size={18} color={colors.blue700} />}
        onPress={async () => {
          const c = await locate(true);
          if (c) await lookup(c);
        }}
      />
      <Card>
        <Txt variant="small">GPS coordinates</Txt>
        <Txt variant="label">{pin ? `${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}` : "Not set"}</Txt>
      </Card>
      <Field label="Address" icon={<MapPin size={18} color={colors.slate500} />} value={address} onChangeText={setAddress} placeholder="House/plot, street, tole" error={error?.fields.address} />
      <Field label="Area / locality" value={area} onChangeText={setArea} placeholder="e.g. Baneshwor" />
      <FormMessage message={error?.message} />
      <Button
        title="Continue"
        loading={save.isPending}
        disabled={!pin}
        onPress={() => pin && save.mutate({ path: "location", json: { ...pin, address, area: area || null } })}
      />
    </View>
  );
}

// --------------------------------------------------------------------------- step 2

function PropertyStep({ app }: { app: ApplicationDetail }) {
  const [form, setForm] = useState({
    property_name: app.property_name ?? "",
    land_size_sqm: app.land_size_sqm ? String(app.land_size_sqm) : "",
    capacity: app.capacity ? String(app.capacity) : "",
    opens_at: app.opens_at?.slice(0, 5) ?? "07:00",
    closes_at: app.closes_at?.slice(0, 5) ?? "21:00",
    price_per_hour: app.price_per_hour ? String(Number(app.price_per_hour)) : "",
  });
  const [type, setType] = useState<ParkingType>(app.parking_type ?? "open_air");
  const [days, setDays] = useState<AvailableDays>(app.available_days ?? "every_day");
  const [pricing, setPricing] = useState<PricingMode>(app.pricing_mode ?? "hourly");
  const save = useSave(app, `/application/${app.id}/edit/owner`);
  const error = save.error ? formErrors(save.error) : null;
  const set = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  return (
    <View style={{ gap: 16 }}>
      <Field label="Property / parking name" value={form.property_name} onChangeText={set("property_name")} placeholder="e.g. Sharma Family Parking" error={error?.fields.property_name} />
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Field label="Land size (m²)" value={form.land_size_sqm} onChangeText={set("land_size_sqm")} keyboardType="number-pad" error={error?.fields.land_size_sqm} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Vehicle capacity" value={form.capacity} onChangeText={set("capacity")} keyboardType="number-pad" error={error?.fields.capacity} />
        </View>
      </Row>
      <Txt variant="label">Parking type</Txt>
      <Chips<ParkingType> value={type} onChange={setType} options={Object.entries(PARKING_TYPE_LABEL).map(([value, label]) => ({ value: value as ParkingType, label }))} />
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Field label="Opens at (HH:MM)" value={form.opens_at} onChangeText={set("opens_at")} keyboardType="numbers-and-punctuation" error={error?.fields.opens_at} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Closes at (HH:MM)" value={form.closes_at} onChangeText={set("closes_at")} keyboardType="numbers-and-punctuation" error={error?.fields.closes_at} />
        </View>
      </Row>
      <Txt variant="label">Available days</Txt>
      <Chips<AvailableDays> value={days} onChange={setDays} options={Object.entries(DAYS_LABEL).map(([value, label]) => ({ value: value as AvailableDays, label }))} />
      <Txt variant="label">Pricing</Txt>
      <Chips<PricingMode> value={pricing} onChange={setPricing} options={[{ value: "hourly", label: "Hourly paid" }, { value: "free", label: "Free parking" }]} />
      {pricing === "hourly" && (
        <Field label="Price per hour (NPR)" value={form.price_per_hour} onChangeText={set("price_per_hour")} keyboardType="decimal-pad" hint="KMC guidance for private lots: NPR 20–60 per hour." error={error?.fields.price_per_hour} />
      )}
      <FormMessage message={error?.message} />
      <Button
        title="Continue"
        loading={save.isPending}
        onPress={() =>
          save.mutate({
            path: "property",
            json: {
              property_name: form.property_name,
              land_size_sqm: form.land_size_sqm ? Number(form.land_size_sqm) : null,
              capacity: form.capacity ? Number(form.capacity) : null,
              parking_type: type,
              opens_at: form.opens_at,
              closes_at: form.closes_at,
              available_days: days,
              pricing_mode: pricing,
              price_per_hour: pricing === "hourly" ? form.price_per_hour || null : null,
            },
          })
        }
      />
    </View>
  );
}

// --------------------------------------------------------------------------- step 3

function OwnerStep({ app }: { app: ApplicationDetail }) {
  const [form, setForm] = useState({
    owner_name: app.owner_name ?? "",
    owner_phone: app.owner_phone ?? "",
    government_id: "",
    ownership_document_number: app.ownership_document_number ?? "",
  });
  const [confirmed, setConfirmed] = useState(app.owner_confirmed);
  const save = useSave(app, `/application/${app.id}/edit/documents`);
  const error = save.error ? formErrors(save.error) : null;
  const set = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));
  const icon = (I: typeof User) => <I size={18} color={colors.slate500} />;

  return (
    <View style={{ gap: 16 }}>
      <Callout title="Your information is protected" icon={<ShieldCheck size={18} color={colors.blue700} />}>
        ID numbers are encrypted and used only for government verification. Only the last four digits are ever shown.
      </Callout>
      <Field label="Legal owner name" icon={icon(User)} value={form.owner_name} onChangeText={set("owner_name")} error={error?.fields.owner_name} />
      <Field label="Phone number" icon={icon(Phone)} value={form.owner_phone} onChangeText={set("owner_phone")} keyboardType="phone-pad" error={error?.fields.owner_phone} />
      <Field
        label="Government ID number"
        icon={icon(IdCard)}
        value={form.government_id}
        onChangeText={set("government_id")}
        placeholder={app.gov_id_masked ? `Saved (${app.gov_id_masked}) — re-enter to confirm` : "e.g. 27-01-75-12345"}
        autoCapitalize="characters"
        error={error?.fields.government_id}
      />
      <Field label="Ownership / Lalpurja number" icon={icon(FileText)} value={form.ownership_document_number} onChangeText={set("ownership_document_number")} error={error?.fields.ownership_document_number} />
      <Card>
        <Row>
          <Switch value={confirmed} onValueChange={setConfirmed} trackColor={{ true: colors.blue600 }} accessibilityLabel="I am the legal owner or an authorised representative" />
          <Txt variant="body" style={{ flex: 1 }}>
            I am the legal owner or an authorised representative of this property.
          </Txt>
        </Row>
      </Card>
      {error?.fields.owner_confirmed && <FormMessage message="Please confirm you are the owner or an authorised representative." />}
      <FormMessage message={error?.message} />
      <Button title="Continue" loading={save.isPending} onPress={() => save.mutate({ path: "owner", json: { ...form, owner_confirmed: confirmed } })} />
    </View>
  );
}

// --------------------------------------------------------------------------- step 4

const KINDS: DocumentKind[] = ["ownership_document", "government_id", "property_photo", "parking_photo"];

function DocumentsStep({ app }: { app: ApplicationDetail }) {
  const [uploading, setUploading] = useState<DocumentKind | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: [`/applications/${app.id}`] });

  // Thumbnails are generated by the worker a moment after upload.
  const processing = app.documents.some((d) => d.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const t = setTimeout(refresh, 1500);
    return () => clearTimeout(t);
  });

  const upload = async (kind: DocumentKind) => {
    const photo = DOCUMENT_LABEL[kind].photo;
    let file: { uri: string; name: string; type: string } | null = null;
    if (photo) {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (picked.canceled) return;
      const a = picked.assets[0];
      file = { uri: a.uri, name: a.fileName ?? "photo.jpg", type: a.mimeType ?? "image/jpeg" };
    } else {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/jpeg", "image/png", "image/webp"], copyToCacheDirectory: true });
      if (picked.canceled) return;
      const a = picked.assets[0];
      file = { uri: a.uri, name: a.name, type: a.mimeType ?? "application/pdf" };
    }
    const form = new FormData();
    form.append("kind", kind);
    // React Native's FormData accepts { uri, name, type } for file parts.
    form.append("file", file as unknown as Blob);
    setUploading(kind);
    try {
      await api(`/applications/${app.id}/documents`, { method: "POST", form });
      await refresh();
    } catch (e) {
      Alert.alert("Upload failed", formErrors(e).message ?? "Please try another file.");
    } finally {
      setUploading(null);
    }
  };

  const remove = async (docId: string) => {
    await api(`/applications/${app.id}/documents/${docId}`, { method: "DELETE" }).catch((e) => Alert.alert("Could not remove", formErrors(e).message ?? undefined));
    await refresh();
  };

  const missing = app.missing.filter((m) => m.startsWith("document:"));
  return (
    <View style={{ gap: 12 }}>
      <Callout icon={<FileText size={18} color={colors.blue700} />}>JPG, PNG, WEBP or PDF up to 10 MB. Location data is removed from photos automatically.</Callout>
      {KINDS.map((kind) => {
        const meta = DOCUMENT_LABEL[kind];
        const files = app.documents.filter((d) => d.kind === kind);
        return (
          <Card key={kind} style={[{ gap: 12, borderStyle: files.length ? "solid" : "dashed" }, files.length > 0 && { backgroundColor: colors.green50, borderColor: colors.green100 }]}>
            <Row>
              <View style={[styles.uploadIcon, files.length > 0 && { backgroundColor: colors.green500 }]}>{files.length ? <Check size={20} color="white" /> : <Upload size={20} color={colors.blue700} />}</View>
              <View style={{ flex: 1 }}>
                <Txt variant="label">
                  {meta.title}
                  {!meta.required ? " (optional)" : ""}
                </Txt>
                <Txt variant="small">{files.length ? `${files.length} uploaded` : meta.hint}</Txt>
              </View>
            </Row>
            {files.map((doc) => (
              <Row key={doc.id} style={styles.filePill}>
                {doc.has_thumbnail ? (
                  <Image source={{ uri: documentUrl(doc.id), headers: authHeaders() }} style={styles.fileThumb} contentFit="cover" />
                ) : (
                  <View style={[styles.fileThumb, { alignItems: "center", justifyContent: "center" }]}>
                    <FileText size={16} color={colors.slate600} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Txt variant="label" numberOfLines={1}>
                    {doc.original_name}
                  </Txt>
                  <Txt variant="small">
                    {formatBytes(doc.size_bytes)} · {doc.status === "processing" ? "Processing…" : doc.status === "failed" ? "Unreadable" : "Ready"}
                  </Txt>
                </View>
                <Pressable onPress={() => void remove(doc.id)} accessibilityLabel={`Remove ${doc.original_name}`} hitSlop={8} style={styles.removeBtn}>
                  <Trash2 size={15} color={colors.slate700} />
                </Pressable>
              </Row>
            ))}
            <Button small variant="secondary" title={files.length ? "Add another" : "Upload file"} loading={uploading === kind} onPress={() => void upload(kind)} icon={<Upload size={15} color={colors.blue700} />} />
          </Card>
        );
      })}
      <Button title="Continue" disabled={missing.length > 0} onPress={() => router.replace(`/application/${app.id}/edit/review` as never)} />
      {missing.length > 0 && (
        <Txt variant="small" style={{ textAlign: "center" }}>
          Upload the required documents to continue.
        </Txt>
      )}
    </View>
  );
}

// --------------------------------------------------------------------------- step 5

function ReviewStep({ app }: { app: ApplicationDetail }) {
  const [declared, setDeclared] = useState(false);
  const submit = useMutation({
    mutationFn: () => api<ApplicationDetail>(`/applications/${app.id}/submit`, { method: "POST", json: { declaration_accepted: true } }),
    onSuccess: () => {
      void invalidate("/applications", "/notifications");
      router.replace(`/application/${app.id}/submitted` as never);
    },
  });
  const error = submit.error ? formErrors(submit.error) : null;
  const section = (title: string, step: Step, body: ReactNode) => (
    <Card>
      <Row style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <Txt variant="h3">{title}</Txt>
        <Pressable onPress={() => router.replace(`/application/${app.id}/edit/${step}` as never)} hitSlop={8}>
          <Txt variant="label" color={colors.blue600}>
            Edit
          </Txt>
        </Pressable>
      </Row>
      {body}
    </Card>
  );

  return (
    <View style={{ gap: 12 }}>
      {app.status === "changes_requested" && app.feedback && (
        <Callout tone="danger" title="Requested by the review team">
          {app.feedback}
        </Callout>
      )}
      {app.missing.length > 0 && (
        <Callout tone="warning" title="Complete these before submitting">
          {app.missing.map((m) => m.replace("document:", "").replace(/_/g, " ")).join(", ")}
        </Callout>
      )}
      {section("Location & property", "property", <PropertySummary app={app} />)}
      {section("Owner", "owner", <OwnerSummary app={app} />)}
      {section(`Documents (${app.documents.length})`, "documents", <DocumentList app={app} />)}
      <Card>
        <Row style={{ alignItems: "flex-start" }}>
          <Switch value={declared} onValueChange={setDeclared} trackColor={{ true: colors.blue600 }} accessibilityLabel="Declaration" />
          <Txt variant="muted" style={{ flex: 1, color: colors.slate700 }}>
            I declare that this information is accurate and consent to government review and site verification.
          </Txt>
        </Row>
      </Card>
      <FormMessage message={error?.message} />
      <Button
        title={app.status === "changes_requested" ? "Resubmit for government approval" : "Submit for government approval"}
        icon={<ShieldCheck size={18} color="white" />}
        disabled={!declared || app.missing.length > 0}
        loading={submit.isPending}
        onPress={() => submit.mutate()}
      />
    </View>
  );
}

export default function EditStep() {
  const { id, step } = useLocalSearchParams<{ id: string; step: Step }>();
  const query = useApi<ApplicationDetail>(`/applications/${id}`);
  const index = WIZARD_STEPS.indexOf(step);

  if (query.isPending) return <Loading />;
  if (query.isError || index < 0) return <Screen><ErrorView error={query.error ?? new Error("Unknown step")} onRetry={() => query.refetch()} /></Screen>;
  const app = query.data;
  if (app.status !== "draft" && app.status !== "changes_requested") {
    router.replace(`/application/${id}` as never);
    return <Loading />;
  }
  const [title, subtitle] = TITLES[step];

  return (
    <Screen>
      <Header title={title} subtitle={subtitle} back />
      <Stepper current={index} app={app} />
      {step === "location" && <LocationStep app={app} />}
      {step === "property" && <PropertyStep app={app} />}
      {step === "owner" && <OwnerStep app={app} />}
      {step === "documents" && <DocumentsStep app={app} />}
      {step === "review" && <ReviewStep app={app} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: "row", justifyContent: "space-between", marginBottom: 22 },
  stepLine: { position: "absolute", left: "10%", right: "10%", top: 14, height: 2, backgroundColor: colors.slate200 },
  stepNum: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.slate300, backgroundColor: colors.slate50, alignItems: "center", justifyContent: "center" },
  uploadIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.blue50, alignItems: "center", justifyContent: "center" },
  filePill: { backgroundColor: "white", borderWidth: 1, borderColor: colors.slate200, borderRadius: 12, padding: 6 },
  fileThumb: { width: 38, height: 38, borderRadius: 8, backgroundColor: colors.slate100 },
  removeBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.slate100, alignItems: "center", justifyContent: "center" },
});

