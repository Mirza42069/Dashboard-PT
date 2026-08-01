"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@DashboardV2/ui/components/alert-dialog";
import { Button } from "@DashboardV2/ui/components/button";
import { DatePicker } from "@DashboardV2/ui/components/date-picker";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@DashboardV2/ui/components/dialog";
import { Input } from "@DashboardV2/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@DashboardV2/ui/components/input-group";
import { Label } from "@DashboardV2/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { Textarea } from "@DashboardV2/ui/components/textarea";
import { daysBetween } from "@DashboardV2/ui/lib/calendar-date";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import z from "zod";

import { FieldError, fieldError, focusFirstInvalid } from "@/components/field-error";
import FormShell from "@/components/form-shell";
import { useStatusLabel } from "@/components/status-badge";
import { interpolate, plural } from "@/i18n";
import { useLocale, useT } from "@/i18n/provider";
import { datePickerLabels } from "@/lib/date-picker-labels";
import { toast } from "@/lib/toast";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;

const NOTES_MAX = 2000;

/**
 * Base UI's Select treats an empty value as "nothing selected", which is not the
 * same thing as the deliberate choice to leave a project unmanaged. A sentinel
 * keeps "Unassigned" a real, selectable option — without one there is no way to
 * remove a manager once assigned, which is how it used to be.
 */
const UNASSIGNED = "unassigned";

export type ProjectFormValues = {
  code: string;
  name: string;
  client: string;
  location: string;
  status: (typeof PROJECT_STATUSES)[number];
  managerId: string;
  /** "" or "YYYY-MM-DD" — the shape the `date` columns use. */
  startDate: string;
  endDate: string;
  /** Kept as text because that is what the control produces; coerced at submit. */
  progress: string;
  notes: string;
};

export const EMPTY_PROJECT: ProjectFormValues = {
  code: "",
  name: "",
  client: "",
  location: "",
  status: "planning",
  managerId: "",
  startDate: "",
  endDate: "",
  progress: "0",
  notes: "",
};

/**
 * A row from `project.list`/`project.get` as the form wants it. Exported so the
 * project detail can open this shared form without maintaining a second mapping
 * that drifts when fields are added.
 */
export function projectToFormValues(row: {
  code: string;
  name: string;
  client: string | null;
  location: string | null;
  status: (typeof PROJECT_STATUSES)[number];
  managerId: string | null;
  startDate: string | null;
  endDate: string | null;
  progress: number;
  notes: string | null;
}): ProjectFormValues {
  return {
    code: row.code,
    name: row.name,
    client: row.client ?? "",
    location: row.location ?? "",
    status: row.status,
    managerId: row.managerId ?? "",
    startDate: row.startDate ?? "",
    endDate: row.endDate ?? "",
    progress: String(row.progress),
    notes: row.notes ?? "",
  };
}

/**
 * An emptied field sends `null`, not `undefined`.
 *
 * `undefined` is dropped by JSON, and `project.update` takes a `.partial()`
 * input, so an absent key means "leave this column alone". Clearing a client or
 * a manager therefore used to be accepted, reported as saved, and thrown away.
 * `null` is the value the API now reads as "empty this column"; on create it is
 * indistinguishable from omitting the key, so one helper covers both.
 */
function blankToNull(value: string) {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export default function ProjectFormDialog({
  open,
  onOpenChange,
  editingId,
  initialValues,
  progressLocked = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create, otherwise the project being edited. */
  editingId: string | null;
  initialValues: ProjectFormValues;
  /**
   * True when an active BoQ baseline supplies this project's progress, in which
   * case the API ignores the `progress` column and typing a figure into it would
   * change nothing on screen.
   */
  progressLocked?: boolean;
}) {
  const t = useT();
  const { intlLocale } = useLocale();
  const { formatDate } = useFormat();
  const statusLabel = useStatusLabel();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /**
   * A code clash is the server's answer, and it is about one field. Kept beside
   * the form rather than pushed into the field's own errorMap: an injected error
   * makes `canSubmit` false, and with validation running only `onSubmit` there is
   * then nothing left that can clear it — the user fixes the code and the button
   * stays dead.
   */
  const [codeConflict, setCodeConflict] = useState<string | null>(null);

  const managers = useQuery(trpc.project.managerOptions.queryOptions());
  const statusOptions = PROJECT_STATUSES.map((value) => ({
    value,
    label: statusLabel("project", value),
  }));
  const managerOptions = [
    { value: UNASSIGNED, label: t.common.unassigned, email: null as string | null },
    ...(managers.data ?? []).map((manager) => ({
      value: manager.id,
      label: manager.name,
      email: manager.email,
    })),
  ];

  const createProject = useMutation(trpc.project.create.mutationOptions());
  const updateProject = useMutation(trpc.project.update.mutationOptions());

  // Built here, not at module scope, so every message can come from the
  // dictionary. Previously these fell through to Zod's own English, which an
  // Indonesian user saw untranslated.
  const schema = z
    .object({
      code: z
        .string()
        .trim()
        .min(1, t.projects.codeRequired)
        .max(32, t.projects.codeTooLong)
        .regex(/^[A-Za-z0-9-]+$/, t.projects.codeFormat),
      name: z.string().trim().min(1, t.projects.nameRequired).max(200, t.projects.nameTooLong),
      client: z.string().trim().max(200, t.projects.clientTooLong),
      location: z.string().trim().max(200, t.projects.locationTooLong),
      status: z.enum(PROJECT_STATUSES),
      managerId: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      progress: z.string().refine((value) => {
        if (value.trim() === "") return true;
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100;
      }, t.projects.progressRange),
      notes: z.string().max(NOTES_MAX, t.projects.notesTooLong),
    })
    // Same rule the server enforces. Reported on endDate because that is the
    // field the user just set and the one they will change to fix it.
    .refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, {
      path: ["endDate"],
      message: t.projects.endBeforeStart,
    });

  const form = useForm({
    defaultValues: initialValues,
    onSubmit: async ({ value }) => {
      const payload = {
        code: value.code,
        name: value.name,
        status: value.status,
        progress: value.progress.trim() === "" ? 0 : Number(value.progress),
        client: blankToNull(value.client),
        location: blankToNull(value.location),
        managerId: blankToNull(value.managerId),
        startDate: blankToNull(value.startDate),
        endDate: blankToNull(value.endDate),
        notes: blankToNull(value.notes),
      };

      try {
        if (editingId) {
          await updateProject.mutateAsync({ id: editingId, ...payload });
        } else {
          await createProject.mutateAsync(payload);
        }
        await queryClient.invalidateQueries(trpc.project.pathFilter());
        toast.success(editingId ? t.projects.updated : t.projects.created);
        close();
      } catch (error) {
        const message = error instanceof Error ? error.message : t.projects.saveFailed;
        // A duplicate code belongs under the code field, where the fix is.
        if (isCodeConflict(error)) {
          setCodeConflict(interpolate(t.projects.codeTaken, { code: value.code.toUpperCase() }));
          // Focus is moved by the effect below, not here: the code input is
          // still aria-invalid="false" in the DOM until React renders this
          // state, so focusing now finds nothing to focus.
          return;
        }
        toast.error(message);
      }
    },
    validators: { onSubmit: schema },
  });

  /**
   * The dialog is never remounted — it stays mounted across opens while the row
   * it edits changes underneath it — so the form has to be reset by hand when
   * the target changes. Without this, opening a second project would show the
   * first one's values.
   */
  useEffect(() => {
    form.reset(initialValues);
    setCodeConflict(null);
    // `form` is stable for the component's life; the target is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, initialValues]);

  /**
   * A rejected code is the one error the user did not already have on screen —
   * it arrives from the server, and the message renders above the fold in a
   * panel that is usually scrolled to the footer. Focus has to follow it, and
   * it has to happen after the render that marks the field invalid, which is
   * what an effect gets that the submit handler does not.
   */
  useEffect(() => {
    if (codeConflict) focusFirstInvalid(formRef.current);
  }, [codeConflict]);

  function close() {
    setConfirmDiscard(false);
    setCodeConflict(null);
    onOpenChange(false);
    // Reopening the create form must not show the abandoned draft.
    form.reset();
  }

  /** Esc, the backdrop and Cancel all land here. */
  function requestClose() {
    if (form.state.isDirty) {
      setConfirmDiscard(true);
      return;
    }
    close();
  }

  // Editing slides in beside the row it belongs to; creating stays centred,
  // because a blank form has no row to sit next to.
  const asSheet = editingId !== null;

  return (
    <>
      <FormShell
        asSheet={asSheet}
        open={open}
        closeLabel={t.common.close}
        // Wider than the default so the two-column rows still fit.
        className="sm:max-w-lg"
        onOpenChange={(next) => {
          if (next) onOpenChange(true);
          else requestClose();
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit().then(() => focusFirstInvalid(formRef.current));
          }}
          className={asSheet ? "flex h-full min-h-0 flex-col" : "space-y-4"}
          noValidate
          ref={formRef}
        >
            {/* DialogHeader/Title/Description work inside the Sheet too: both
                shells are built on the same @base-ui/react/dialog primitive, so
                these read the same context and label whichever popup is open. */}
            <DialogHeader className={asSheet ? "gap-1 p-4 pr-12" : undefined}>
              <DialogTitle>
                {editingId ? t.projects.editProject : t.projects.newProject}
              </DialogTitle>
              <DialogDescription>
                {editingId ? t.projects.editDescription : t.projects.createDescription}
              </DialogDescription>
            </DialogHeader>

            <div
              className={
                asSheet
                  ? "min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-2"
                  : "max-h-[60vh] space-y-5 overflow-y-auto pr-1"
              }
            >
              <Group legend={t.projects.groupIdentity}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field name="code">
                    {(field) => {
                      const error = fieldError(field.name, [
                        ...field.state.meta.errors,
                        codeConflict,
                      ]);
                      const hintId = `${field.name}-hint`;
                      return (
                        <div className="space-y-2">
                          <FieldLabel htmlFor={field.name} required>
                            {t.projects.code}
                          </FieldLabel>
                          <Input
                            {...error.control}
                            aria-describedby={describedBy(hintId, error)}
                            aria-required
                            name={field.name}
                            placeholder="PRJ-001"
                            className="font-mono"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => {
                              // The server upper-cases this, so anything else
                              // here means what you typed is not what you get.
                              field.handleChange(e.target.value.toUpperCase());
                              setCodeConflict(null);
                            }}
                          />
                          <p id={hintId} className="text-xs text-muted-foreground">
                            {t.projects.codeHint}
                          </p>
                          <FieldError {...error} />
                        </div>
                      );
                    }}
                  </form.Field>

                  <form.Field name="status">
                    {(field) => (
                      <div className="space-y-2">
                        <FieldLabel htmlFor={field.name}>{t.projects.statusLabel}</FieldLabel>
                        <Select
                          items={statusOptions}
                          value={field.state.value}
                          onValueChange={(value) => {
                            if (value) field.handleChange(value);
                          }}
                        >
                          <SelectTrigger id={field.name} className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {statusOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </form.Field>
                </div>

                <form.Field name="name">
                  {(field) => (
                    <TextField label={t.projects.name} field={field} required />
                  )}
                </form.Field>
              </Group>

              <Group legend={t.projects.groupClientSite}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field name="client">
                    {(field) => <TextField label={t.projects.client} field={field} optional />}
                  </form.Field>
                  <form.Field name="location">
                    {(field) => <TextField label={t.projects.location} field={field} optional />}
                  </form.Field>
                </div>

                <form.Field name="managerId">
                  {(field) => (
                    <div className="space-y-2">
                      <FieldLabel htmlFor={field.name} optional>
                        {t.projects.manager}
                      </FieldLabel>
                      <Select
                        items={managerOptions}
                        value={field.state.value === "" ? UNASSIGNED : field.state.value}
                        onValueChange={(value) =>
                          field.handleChange(!value || value === UNASSIGNED ? "" : value)
                        }
                      >
                        <SelectTrigger id={field.name} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {managerOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <span className="flex flex-col items-start">
                                <span>{option.label}</span>
                                {/* Two people can share a name; the address is
                                    what tells them apart. */}
                                {option.email && (
                                  <span className="text-muted-foreground">{option.email}</span>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </form.Field>
              </Group>

              <Group legend={t.projects.groupSchedule}>
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Deliberately unbounded, while the target below is bounded by
                      it. Capping the start at the target too would deadlock the
                      pair: with both set, moving the window later needs a start
                      after the current target, and there would be no way to pick
                      one without clearing the target first. The start is the
                      anchor; if it overtakes the target, the target says so. */}
                  <form.Field name="startDate">
                    {(field) => {
                      const error = fieldError(field.name, field.state.meta.errors);
                      return (
                        <div className="space-y-2">
                          <FieldLabel htmlFor={field.name} optional>
                            {t.projects.startDate}
                          </FieldLabel>
                          <DatePicker
                            {...error.control}
                            name={field.name}
                            value={field.state.value || null}
                            locale={intlLocale}
                            formatValue={formatDate}
                            labels={datePickerLabels(t)}
                            onValueChange={(next) => field.handleChange(next ?? "")}
                            onBlur={field.handleBlur}
                          />
                          <FieldError {...error} />
                        </div>
                      );
                    }}
                  </form.Field>

                  <form.Subscribe selector={(state) => state.values.startDate}>
                    {(startDate) => (
                      <form.Field name="endDate">
                        {(field) => {
                          const error = fieldError(field.name, field.state.meta.errors);
                          return (
                            <div className="space-y-2">
                              <FieldLabel htmlFor={field.name} optional>
                                {t.projects.targetCompletion}
                              </FieldLabel>
                              <DatePicker
                                {...error.control}
                                name={field.name}
                                value={field.state.value || null}
                                // Days before the start are struck through rather
                                // than merely rejected on submit.
                                min={startDate || null}
                                locale={intlLocale}
                                formatValue={formatDate}
                                labels={datePickerLabels(t)}
                                onValueChange={(next) => field.handleChange(next ?? "")}
                                onBlur={field.handleBlur}
                              />
                              <FieldError {...error} />
                            </div>
                          );
                        }}
                      </form.Field>
                    )}
                  </form.Subscribe>
                </div>

                <form.Subscribe
                  selector={(state) => ({
                    startDate: state.values.startDate,
                    endDate: state.values.endDate,
                  })}
                >
                  {({ startDate, endDate }) => <Span start={startDate} end={endDate} />}
                </form.Subscribe>

                <form.Field name="progress">
                  {(field) => {
                    const error = fieldError(field.name, field.state.meta.errors);
                    const hintId = `${field.name}-hint`;
                    return (
                      <div className="space-y-2">
                        <FieldLabel htmlFor={field.name}>{t.projects.siteProgress}</FieldLabel>
                        <InputGroup className="h-9 w-full sm:max-w-40 md:h-8">
                          <InputGroupInput
                            {...error.control}
                            // Only point at the hint when the hint is on the
                            // page — the locked case is the only one that
                            // renders it, and a dangling aria-describedby is
                            // worse than none.
                            aria-describedby={
                              progressLocked
                                ? describedBy(hintId, error)
                                : error.control["aria-describedby"]
                            }
                            name={field.name}
                            inputMode="numeric"
                            disabled={progressLocked}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupText>%</InputGroupText>
                          </InputGroupAddon>
                        </InputGroup>
                        {/* Only the locked case needs explaining. An editable
                            percent field labelled "Site progress" explains
                            itself, and a hint under every field is noise. */}
                        {progressLocked && (
                          <p id={hintId} className="text-xs text-muted-foreground">
                            {t.projects.progressLockedHint}
                          </p>
                        )}
                        <FieldError {...error} />
                      </div>
                    );
                  }}
                </form.Field>
              </Group>

              <form.Field name="notes">
                {(field) => {
                  const error = fieldError(field.name, field.state.meta.errors);
                  const remaining = NOTES_MAX - field.state.value.length;
                  return (
                    <div className="space-y-2">
                      <FieldLabel htmlFor={field.name} optional>
                        {t.projects.notes}
                      </FieldLabel>
                      <Textarea
                        {...error.control}
                        name={field.name}
                        rows={3}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                      {/* Only once it is nearly a problem — a counter on an empty
                          field is noise. Past the limit it counts the overage
                          rather than reading "-12 characters left", and says so
                          before submit, which is the only time validation runs. */}
                      {remaining <= NOTES_MAX * 0.2 && (
                        <p
                          className={
                            remaining < 0
                              ? "text-xs text-destructive"
                              : "text-xs text-muted-foreground"
                          }
                        >
                          {remaining < 0
                            ? plural(t.projects.notesOver, -remaining)
                            : plural(t.projects.notesRemaining, remaining)}
                        </p>
                      )}
                      <FieldError {...error} />
                    </div>
                  );
                }}
              </form.Field>
            </div>

            <DialogFooter
              className={asSheet ? "border-t border-border bg-popover p-4" : undefined}
            >
              <Button type="button" variant="outline" onClick={requestClose}>
                {t.common.cancel}
              </Button>
              <form.Subscribe
                selector={(state) => ({
                  canSubmit: state.canSubmit,
                  isSubmitting: state.isSubmitting,
                })}
              >
                {({ canSubmit, isSubmitting }) => (
                  <Button type="submit" disabled={!canSubmit || isSubmitting}>
                    {isSubmitting
                      ? t.common.saving
                      : editingId
                        ? t.projects.saveChanges
                        : t.projects.createProject}
                  </Button>
                )}
              </form.Subscribe>
            </DialogFooter>
          </form>
      </FormShell>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.projects.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.projects.discardDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.keepEditing}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={close}>
              {t.common.discardChanges}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * One set of fields under a heading. A real `<fieldset>`/`<legend>`, so the
 * grouping is announced ("Schedule, Start date") rather than being purely
 * visual — with eleven fields in one dialog that context is most of the value.
 */
function Group({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-xs font-medium text-foreground">{legend}</legend>
      <div className="space-y-4 pt-3">{children}</div>
    </fieldset>
  );
}

function FieldLabel({
  htmlFor,
  required = false,
  optional = false,
  children,
}: {
  htmlFor: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <Label htmlFor={htmlFor}>
      {children}
      {/* Only two of these eleven fields are required, so the asterisks stay few.
          Screen readers get it from aria-required on the control, which is why
          this is aria-hidden rather than a second announcement. */}
      {required && (
        <span aria-hidden className="text-destructive">
          *
        </span>
      )}
      {optional && <span className="text-muted-foreground">({t.common.optional})</span>}
    </Label>
  );
}

/**
 * The contract window, which is the one thing on this form the user cannot work
 * out at a glance. It is also where the end-before-start error lands, so the
 * correction shows up next to the dates rather than under the submit button.
 */
function Span({ start, end }: { start: string; end: string }) {
  const t = useT();
  const { formatDate } = useFormat();

  if (!start || !end || end < start) return null;

  // Inclusive: a job starting and finishing on the same day lasts one day.
  const days = daysBetween(start, end) + 1;
  // Weeks are how construction programmes are discussed, but rounding a
  // three-day job to "1 week" is just wrong, so short spans stay in days.
  const length =
    days < 14
      ? plural(t.projects.spanDays, days)
      : plural(t.projects.spanWeeks, Math.round(days / 7));

  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      {formatDate(start)} → {formatDate(end)}
      <span className="mx-1.5 text-muted-foreground/50">·</span>
      <span className="text-foreground">{length}</span>
    </p>
  );
}

/** A hint and an error both describe the control; the hint comes first. */
function describedBy(hintId: string, error: ReturnType<typeof fieldError>) {
  const errorId = error.control["aria-describedby"];
  return errorId ? `${hintId} ${errorId}` : hintId;
}

/**
 * tRPC surfaces a duplicate project code as CONFLICT. The client wraps it as a
 * TRPCClientError carrying `data.code`, while a directly-called procedure throws
 * a TRPCError carrying `code` — both are checked so this keeps working under
 * either, and a miss only means the message lands in a toast instead.
 */
function isCodeConflict(error: unknown): boolean {
  const shape = error as { code?: string; data?: { code?: string } } | null;
  return shape?.data?.code === "CONFLICT" || shape?.code === "CONFLICT";
}

/* eslint-disable @typescript-eslint/no-explicit-any -- TanStack Form field API */
function TextField({
  label,
  field,
  required = false,
  optional = false,
}: {
  label: string;
  field: any;
  required?: boolean;
  optional?: boolean;
}) {
  const error = fieldError(field.name, field.state.meta.errors);

  return (
    <div className="space-y-2">
      <FieldLabel htmlFor={field.name} required={required} optional={optional}>
        {label}
      </FieldLabel>
      <Input
        {...error.control}
        aria-required={required || undefined}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => field.handleChange(e.target.value)}
      />
      <FieldError {...error} />
    </div>
  );
}
