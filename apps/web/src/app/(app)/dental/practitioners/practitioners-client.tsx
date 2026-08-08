"use client";

import { Badge } from "@DashboardV2/ui/components/badge";
import { Button } from "@DashboardV2/ui/components/button";
import { Card, CardContent } from "@DashboardV2/ui/components/card";
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
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { DentalDoctor } from "@DashboardV2/ui/components/dental-icons";
import { Pencil, Plus } from "@DashboardV2/ui/components/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { QueryError } from "@/components/query-error";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { trpc } from "@/utils/trpc";

import { PageHeader } from "../dental-ui";

type PractitionerDraft = {
  id: string;
  userId: string;
  providerCode: string;
  displayName: string;
  specialty: string | null;
  phone: string | null;
  color: string | null;
  active: boolean;
};

type UserOption = { id: string; name: string; email: string };

export default function PractitionersClient() {
  const t = useT();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PractitionerDraft | null>(null);
  const practitioners = useQuery(trpc.dental.practitioners.list.queryOptions({ includeInactive: true }));
  const users = useQuery(trpc.admin.listUsers.queryOptions({ search: "", limit: 100, offset: 0 }));
  const companies = useQuery(trpc.company.options.queryOptions());
  const activeId = companies.data?.activeId;
  const userOptions = (users.data?.users ?? [])
    .filter((user) => user.companyId === activeId && user.role !== "super_admin" && !user.banned)
    .map((user) => ({ id: user.id, name: user.name, email: user.email }));

  async function refresh() {
    await queryClient.invalidateQueries(trpc.dental.pathFilter());
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader title={t.dental.practitionersTitle} action={<PractitionerDialog key={editing?.id ?? "new"} draft={editing} users={userOptions} onOpenChange={(open) => !open && setEditing(null)} onSaved={refresh} />} />
      {practitioners.isPending && <Skeleton className="h-64 w-full" />}
      {practitioners.isError && <QueryError error={practitioners.error} onRetry={() => void practitioners.refetch()} />}
      {practitioners.data?.length === 0 && <Card><CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 text-center"><DentalDoctor className="size-8 text-muted-foreground" /><p className="font-medium">{t.dental.noPractitionerProfiles}</p>{userOptions.length === 0 && <p className="text-sm text-muted-foreground">{t.dental.noAssignableUsers}</p>}</CardContent></Card>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {practitioners.data?.map((practitioner) => <Card key={practitioner.id}><CardContent className="flex items-start gap-4"><div className="grid size-11 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><DentalDoctor className="size-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium">{practitioner.displayName}</p><Badge variant={practitioner.active ? "secondary" : "outline"}>{practitioner.active ? t.users.active : t.users.paused}</Badge></div><p className="text-xs text-muted-foreground">{practitioner.providerCode}{practitioner.specialty ? ` · ${practitioner.specialty}` : ""}</p>{practitioner.phone && <p className="mt-2 text-sm">{practitioner.phone}</p>}</div><Button variant="ghost" size="icon" className="size-11" aria-label={t.dental.editPractitioner} onClick={() => setEditing(practitioner)}><Pencil /></Button></CardContent></Card>)}
      </div>
    </div>
  );
}

function PractitionerDialog({ draft, users, onOpenChange, onSaved }: { draft: PractitionerDraft | null; users: UserOption[]; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState(draft?.userId ?? "");
  const [active, setActive] = useState(draft?.active ?? true);
  const upsert = useMutation(trpc.dental.practitioners.upsert.mutationOptions());
  const selectableUsers = draft && !users.some((user) => user.id === draft.userId) ? [{ id: draft.userId, name: draft.displayName, email: "" }, ...users] : users;

  function changeOpen(next: boolean) { setOpen(next); onOpenChange(next); }
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (!userId) return; const text = (name: string) => String(data.get(name) ?? "").trim() || null; try { await upsert.mutateAsync({ id: draft?.id, userId, providerCode: text("providerCode")!, displayName: text("displayName")!, specialty: text("specialty"), phone: text("phone"), color: draft?.color ?? null, active }); await onSaved(); changeOpen(false); form.reset(); toast.success(t.dental.practitionerSaved); } catch (error) { toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong); } }

  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger render={<Button className="h-11" />}><Plus />{t.dental.addPractitioner}</DialogTrigger><DialogContent closeLabel={t.common.close}><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle className="font-serif text-xl">{draft ? t.dental.editPractitioner : t.dental.addPractitioner}</DialogTitle></DialogHeader>{selectableUsers.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{t.dental.noAssignableUsers}</p> : <><Field label={t.dental.linkedUser} id="practitionerUser"><Select items={[]} value={userId} onValueChange={(value) => setUserId(value ?? "")} disabled={Boolean(draft)} required><SelectTrigger id="practitionerUser" className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent>{selectableUsers.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}{user.email ? ` · ${user.email}` : ""}</SelectItem>)}</SelectContent></Select></Field><div className="grid gap-4 sm:grid-cols-2"><Field label={t.dental.providerCode} id="providerCode"><Input id="providerCode" name="providerCode" defaultValue={draft?.providerCode} required /></Field><Field label={t.dental.displayName} id="displayName"><Input id="displayName" name="displayName" defaultValue={draft?.displayName} required /></Field><Field label={t.dental.specialty} id="specialty"><Input id="specialty" name="specialty" defaultValue={draft?.specialty ?? ""} /></Field><Field label={t.dental.phone} id="practitionerPhone"><Input id="practitionerPhone" name="phone" type="tel" defaultValue={draft?.phone ?? ""} /></Field><label className="flex min-h-11 items-center gap-3 rounded-md border px-3 sm:col-span-2"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="size-4 accent-[var(--dental-jade)]" /><span className="text-sm font-medium">{t.dental.activeProfile}</span></label></div></>}<DialogFooter><Button type="button" variant="outline" onClick={() => changeOpen(false)}>{t.common.cancel}</Button><Button type="submit" disabled={upsert.isPending || selectableUsers.length === 0}>{t.common.save}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{children}</div>; }
