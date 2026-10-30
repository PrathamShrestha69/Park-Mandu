"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { createContext, use, useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError as UiFieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/types";
import { cn } from "@/lib/utils";

import { DialogContext } from "./interactive";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const FormContext = createContext<FormState>({});

/** A <form> bound to a Server Action; field components read its returned errors and values. */
export function ActionForm({
  action,
  children,
  className = "flex flex-col gap-5",
  onSuccess,
  id,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  onSuccess?: () => void;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const dialog = use(DialogContext);
  const handled = useRef<FormState | null>(null);
  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      onSuccess?.();
      dialog?.close();
    }
  }, [state, onSuccess, dialog]);
  return (
    <FormContext value={state}>
      <form action={formAction} className={className} id={id} noValidate>
        {children}
      </form>
    </FormContext>
  );
}

export function useFormResult(): FormState {
  return use(FormContext);
}

export function FormMessage({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm font-medium [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
        ok ? "border-success/25 bg-success/[0.08] text-success-ink" : "border-destructive/25 bg-destructive/[0.06] text-destructive",
      )}
      role={ok ? "status" : "alert"}
      aria-live="polite"
    >
      {ok ? <CircleCheck /> : <CircleAlert />}
      <span>{children}</span>
    </div>
  );
}

export function FormAlert({ successFallback }: { successFallback?: string }) {
  const state = useFormResult();
  if (!state.message && !(state.ok && successFallback)) return null;
  return <FormMessage ok={state.ok}>{state.message ?? successFallback}</FormMessage>;
}

function useFieldState(name: string, defaultValue?: string | number | null) {
  const state = useFormResult();
  const error = state.fields?.[name];
  const value = state.values?.[name] ?? (defaultValue === null || defaultValue === undefined ? "" : String(defaultValue));
  return { error, value };
}

interface BaseFieldProps {
  name: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  defaultValue?: string | number | null;
  required?: boolean;
}

function FieldLabelText({ label, required }: { label: string; required?: boolean }) {
  return (
    <>
      {label}
      {required && (
        <span aria-hidden className="text-muted-foreground">
          *
        </span>
      )}
    </>
  );
}

function FieldFoot({ id, error, hint }: { id: string; error?: string; hint?: string }) {
  if (error) return <UiFieldError id={`${id}-error`}>{error}</UiFieldError>;
  if (hint) return <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>;
  return null;
}

export function TextField({
  name,
  label,
  hint,
  icon,
  defaultValue,
  required,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
  min,
  max,
  step,
}: BaseFieldProps & {
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "search";
  min?: number;
  max?: number;
  step?: number | string;
}) {
  const { error, value } = useFieldState(name, defaultValue);
  const id = `f-${name}`;
  const inputKey = type === "password" ? undefined : value;
  const inputProps = {
    id,
    name,
    type,
    defaultValue: type === "password" ? undefined : value,
    placeholder,
    autoComplete,
    inputMode,
    required,
    min,
    max,
    step,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
  return (
    <Field data-invalid={error ? true : undefined} className="gap-2">
      <FieldLabel htmlFor={id}>
        <FieldLabelText label={label} required={required} />
      </FieldLabel>
      {icon ? (
        <InputGroup>
          <InputGroupInput key={inputKey} {...inputProps} />
          <InputGroupAddon className="pl-3">{icon}</InputGroupAddon>
        </InputGroup>
      ) : (
        <Input key={inputKey} {...inputProps} />
      )}
      <FieldFoot id={id} error={error} hint={hint} />
    </Field>
  );
}

export function TextAreaField({
  name,
  label,
  hint,
  defaultValue,
  required,
  placeholder,
  rows = 4,
}: BaseFieldProps & { placeholder?: string; rows?: number }) {
  const { error, value } = useFieldState(name, defaultValue);
  const id = `f-${name}`;
  return (
    <Field data-invalid={error ? true : undefined} className="gap-2">
      <FieldLabel htmlFor={id}>
        <FieldLabelText label={label} required={required} />
      </FieldLabel>
      <Textarea
        id={id}
        name={name}
        key={value}
        defaultValue={value}
        placeholder={placeholder}
        required={required}
        rows={rows}
        className="min-h-24"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      />
      <FieldFoot id={id} error={error} hint={hint} />
    </Field>
  );
}

export function SelectField({
  name,
  label,
  hint,
  defaultValue,
  required,
  options,
  placeholder,
}: BaseFieldProps & { options: { value: string; label: string }[]; placeholder?: string }) {
  const { error, value } = useFieldState(name, defaultValue);
  const id = `f-${name}`;
  return (
    <Field data-invalid={error ? true : undefined} className="gap-2">
      <FieldLabel htmlFor={id}>
        <FieldLabelText label={label} required={required} />
      </FieldLabel>
      <NativeSelect
        id={id}
        name={name}
        key={value}
        defaultValue={value}
        required={required}
        className="w-full"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      >
        {placeholder && (
          <NativeSelectOption value="" disabled>
            {placeholder}
          </NativeSelectOption>
        )}
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={o.value}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <FieldFoot id={id} error={error} hint={hint} />
    </Field>
  );
}

export function CheckField({ name, children, defaultChecked }: { name: string; children: ReactNode; defaultChecked?: boolean }) {
  const state = useFormResult();
  const error = state.fields?.[name];
  const id = `f-${name}`;
  return (
    <Field data-invalid={error ? true : undefined} className="gap-2">
      <FieldLabel
        htmlFor={id}
        className="w-full cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 text-sm leading-relaxed font-normal text-muted-foreground transition-colors has-data-checked:border-foreground/25 has-data-checked:text-foreground"
      >
        <Checkbox id={id} name={name} defaultChecked={defaultChecked} aria-invalid={error ? true : undefined} className="mt-0.5 size-[18px]" />
        <span>{children}</span>
      </FieldLabel>
      {error && <UiFieldError>{error}</UiFieldError>}
    </Field>
  );
}

export function FieldError({ name }: { name: string }) {
  const error = useFormResult().fields?.[name];
  return error ? <UiFieldError>{error}</UiFieldError> : null;
}

const SUBMIT_VARIANT = {
  primary: "default",
  secondary: "outline",
  danger: "danger",
  success: "default",
  ghost: "ghost",
} as const;

export function SubmitButton({
  children,
  variant = "primary",
  block = true,
  pendingLabel,
  icon,
  name,
  value,
  small,
}: {
  children: ReactNode;
  variant?: keyof typeof SUBMIT_VARIANT;
  block?: boolean;
  pendingLabel?: string;
  icon?: ReactNode;
  name?: string;
  value?: string;
  small?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name={name}
      value={value}
      variant={SUBMIT_VARIANT[variant]}
      size={small ? "sm" : "lg"}
      className={cn(block && "w-full")}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? <Spinner /> : icon}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
