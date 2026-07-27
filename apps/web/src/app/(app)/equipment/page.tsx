import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";

import EquipmentTable from "./equipment-table";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.equipment.title} · ${BRAND_NAME}` };
}

export default async function EquipmentPage() {
  const session = await requireSession();
  const dict = getDictionary(await getLocale());

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{dict.equipment.title}</h1>
      </div>

      <EquipmentTable isAdmin={session.user.role === "admin"} />
    </div>
  );
}
