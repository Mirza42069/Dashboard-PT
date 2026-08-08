"use client";

import type { Role } from "@DashboardV2/api/lib/permissions";
import { Button } from "@DashboardV2/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@DashboardV2/ui/components/dialog";
import { Input } from "@DashboardV2/ui/components/input";
import { Label } from "@DashboardV2/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "@DashboardV2/ui/components/icons";
import { useRef, useState } from "react";
import { toast } from "@/lib/toast";
import z from "zod";

import { FieldError, fieldError, focusFirstInvalid } from "@/components/field-error";
import { useT } from "@/i18n/provider";
import { trpc } from "@/utils/trpc";

import type { TempPasswordResult } from "./temp-password-dialog";

type CreateRole = "super_admin" | "admin" | "user";

export default function CreateUserDialog({
  actorRole,
  onCreated,
}: {
  actorRole: Role;
  onCreated: (result: TempPasswordResult) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const isSuperAdmin = actorRole === "super_admin";
  const formRef = useRef<HTMLFormElement>(null);

  const createUser = useMutation(trpc.admin.createUser.mutationOptions());
  // company.list is super-admin-only server-side; a company admin creates
  // Users in their own company only, so there is nothing to pick from.
  const companies = useQuery({ ...trpc.company.list.queryOptions(), enabled: isSuperAdmin });
  const roleItems = isSuperAdmin
    ? [
        { value: "user", label: t.users.roleUser },
        { value: "admin", label: t.users.roleAdmin },
        { value: "super_admin", label: t.users.roleSuperAdmin },
      ]
    : [{ value: "user", label: t.users.roleUser }];
  const companyItems =
    companies.data?.companies.map((company) => ({
      value: company.id,
      label: `${company.name} · ${
        company.vertical === "dental" ? t.company.verticalDental : t.company.verticalConstruction
      }`,
    })) ?? [];

  const schema = z
    .object({
      name: z.string().trim().min(1, t.users.nameRequired).max(120),
      email: z.email(t.auth.invalidEmail),
      role: z.enum(["super_admin", "admin", "user"]),
      companyId: z.string(),
    })
    // Super admins are unpinned and pick an active company instead; an admin
    // or a regular account with no company cannot resolve a scope and is
    // locked out.
    .refine((value) => value.role === "super_admin" || value.companyId !== "", {
      message: t.company.required,
      path: ["companyId"],
    });

  const form = useForm({
    defaultValues: {
      name: "",
      email: "",
      role: "user" as CreateRole,
      companyId: "",
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        const data = await createUser.mutateAsync({
          name: value.name,
          email: value.email,
          role: value.role,
          companyId: value.companyId === "" ? undefined : value.companyId,
        });
        await queryClient.invalidateQueries(trpc.admin.pathFilter());
        setOpen(false);
        formApi.reset();
        onCreated({ email: value.email, password: data.temporaryPassword, isNewAccount: true });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.users.createFailed);
      }
    },
    validators: {
      onSubmit: schema,
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset();
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <UserPlus />
        {t.users.newUser}
      </DialogTrigger>
      <DialogContent closeLabel={t.common.close}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit().then(() => focusFirstInvalid(formRef.current));
          }}
          className="space-y-4"
          noValidate
          ref={formRef}
        >
          <DialogHeader>
            <DialogTitle>{t.users.createTitle}</DialogTitle>
          </DialogHeader>

          <form.Field name="name">
            {(field) => {
              const error = fieldError(field.name, field.state.meta.errors);
              return (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t.users.fullName}</Label>
                  <Input
                    {...error.control}
                    name={field.name}
                    autoComplete="name"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldError {...error} />
                </div>
              );
            }}
          </form.Field>

          <form.Field name="email">
            {(field) => {
              const error = fieldError(field.name, field.state.meta.errors);
              return (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t.users.workEmail}</Label>
                  <Input
                    {...error.control}
                    name={field.name}
                    type="email"
                    autoComplete="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldError {...error} />
                </div>
              );
            }}
          </form.Field>

          {/* A company admin can only ever create a User in their own
              company — the server forces both, so the form has nothing to
              ask here beyond name and email. */}
          {isSuperAdmin && (
            <form.Field name="role">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t.users.role}</Label>
                  <Select
                    items={roleItems}
                    value={field.state.value}
                    onValueChange={(value) => field.handleChange((value ?? "user") as CreateRole)}
                  >
                    <SelectTrigger id={field.name} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roleItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t.users.roleHint}</p>
                </div>
              )}
            </form.Field>
          )}

          {/* Only meaningful for a pinned account — a super admin sees every
              company through the switcher, so pinning them to one would be
              misleading. */}
          {isSuperAdmin && (
            <form.Subscribe selector={(state) => state.values.role}>
              {(role) =>
                role === "super_admin" ? null : (
                  <form.Field name="companyId">
                    {(field) => {
                      const error = fieldError(field.name, field.state.meta.errors);
                      return (
                        <div className="space-y-2">
                          <Label htmlFor={field.name}>{t.company.label}</Label>
                          <Select
                            items={companyItems}
                            value={field.state.value}
                            onValueChange={(value) => field.handleChange(value ?? "")}
                          >
                            <SelectTrigger {...error.control} className="w-full">
                              <SelectValue>
                                {(value) =>
                                  companyItems.find((item) => item.value === value)?.label ??
                                  t.company.placeholder
                                }
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {companyItems.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">{t.company.userHint}</p>
                          <FieldError {...error} />
                        </div>
                      );
                    }}
                  </form.Field>
                )
              }
            </form.Subscribe>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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
                  {isSubmitting ? t.users.creating : t.users.createUser}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
