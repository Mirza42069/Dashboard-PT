"use client";

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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { useT } from "@/i18n/provider";
import { trpc } from "@/utils/trpc";

import type { TempPasswordResult } from "./temp-password-dialog";

export default function CreateUserDialog({
  onCreated,
}: {
  onCreated: (result: TempPasswordResult) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const createUser = useMutation(trpc.admin.createUser.mutationOptions());

  const schema = z.object({
    name: z.string().trim().min(1, t.users.nameRequired).max(120),
    email: z.email(t.auth.invalidEmail),
    role: z.enum(["admin", "user"]),
  });

  const form = useForm({
    defaultValues: {
      name: "",
      email: "",
      role: "user" as "admin" | "user",
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        const data = await createUser.mutateAsync(value);
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
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{t.users.createTitle}</DialogTitle>
          </DialogHeader>

          <form.Field name="name">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t.users.fullName}</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-xs text-destructive">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>

          <form.Field name="email">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t.users.workEmail}</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-xs text-destructive">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>

          <form.Field name="role">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t.users.role}</Label>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange((value ?? "user") as "admin" | "user")}
                >
                  <SelectTrigger id={field.name} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">{t.users.roleUser}</SelectItem>
                    <SelectItem value="admin">{t.users.roleAdmin}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t.users.roleHint}</p>
              </div>
            )}
          </form.Field>

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
