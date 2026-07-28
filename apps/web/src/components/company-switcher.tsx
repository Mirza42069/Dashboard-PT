"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useT } from "@/i18n/provider";
import { writeCompanyCookie } from "@/lib/company";
import { trpc } from "@/utils/trpc";

/**
 * Which company the dashboard is currently showing.
 *
 * Admins get a picker; everyone else gets their company's name as plain text,
 * because a regular account cannot switch — the server ignores the cookie for
 * them and scopes by user.companyId regardless.
 */
export default function CompanySwitcher() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const options = useQuery(trpc.company.options.queryOptions());
  const companies = options.data?.companies ?? [];
  const activeId = options.data?.activeId ?? "";
  const canSwitch = options.data?.canSwitch ?? false;

  async function select(companyId: string) {
    if (!companyId || companyId === activeId) return;
    setPending(true);
    writeCompanyCookie(companyId);
    // The cookie changes what every query resolves to, so nothing cached under
    // the old company may survive — and server components need re-rendering too.
    await queryClient.invalidateQueries();
    router.refresh();
    setPending(false);
  }

  if (options.isPending) {
    return <div className="h-8 w-40 animate-pulse rounded-md bg-muted" aria-hidden />;
  }

  if (!canSwitch) {
    const name = companies[0]?.name;
    if (!name) return null;
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Building2 className="size-3.5 shrink-0" />
        <span className="max-w-40 truncate font-medium text-foreground">{name}</span>
      </div>
    );
  }

  return (
    <Select value={activeId} onValueChange={(value) => void select(value ?? "")} disabled={pending}>
      <SelectTrigger size="sm" className="w-44" aria-label={t.company.switcherLabel}>
        <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {companies.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
