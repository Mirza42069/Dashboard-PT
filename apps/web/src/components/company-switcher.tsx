"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "@DashboardV2/ui/components/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useT } from "@/i18n/provider";
import { writeCompanyCookie } from "@/lib/company";
import { trpc } from "@/utils/trpc";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function companyLabel(company: { id: string; name: string }, fallback: string) {
  const name = company.name.trim();
  return name && name !== company.id && !UUID.test(name) ? name : fallback;
}

/**
 * Which company the dashboard is currently showing.
 *
 * System accounts get a picker. The header does not mount this control for
 * company-pinned User or Admin accounts.
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
  const companyItems = companies.map((company) => ({
    value: company.id,
    label: companyLabel(company, t.company.placeholder),
  }));
  const activeCompany = companies.find((company) => company.id === activeId);
  const activeLabel = activeCompany
    ? companyLabel(activeCompany, t.company.placeholder)
    : t.company.placeholder;

  async function select(companyId: string) {
    if (!companyId || companyId === activeId) return;
    setPending(true);
    writeCompanyCookie(companyId);
    // The cookie changes what every query resolves to, so nothing cached under
    // the old company may survive — and server components need re-rendering too.
    queryClient.clear();
    router.refresh();
    setPending(false);
  }

  if (options.isPending) {
    // w-44 to match the resolved Select trigger below. A narrower placeholder
    // shifts the whole header the moment the query lands.
    return <div className="h-8 w-44 animate-pulse rounded-md bg-muted" aria-hidden />;
  }

  if (!canSwitch) {
    const company = companies[0];
    if (!company) return null;
    return (
      // Same w-44 box as the admin trigger and the placeholder, so the header
      // lays out identically for both roles and across the loading swap.
      <div className="flex h-8 w-44 items-center gap-1.5 text-xs text-muted-foreground">
        <Building2 className="size-3.5 shrink-0" />
        <span className="truncate font-medium text-foreground">
          {companyLabel(company, t.company.placeholder)}
        </span>
      </div>
    );
  }

  return (
    <Select
      items={companyItems}
      value={activeCompany ? activeId : null}
      onValueChange={(value) => void select(value ?? "")}
      disabled={pending}
    >
      <SelectTrigger size="sm" className="w-44" aria-label={t.company.switcherLabel}>
        <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
        <SelectValue>{activeLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {companies.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {companyLabel(item, t.company.placeholder)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
