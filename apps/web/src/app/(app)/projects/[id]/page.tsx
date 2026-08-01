import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";

import ProjectDetail from "./project-detail";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.projects.project} - ${BRAND_NAME}` };
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Loading this page at all already required project:read — for a User that
  // means membership, and members get full CRUD within their assigned
  // projects, so there is no narrower "can edit" condition to compute here.
  const session = await requireSession();
  const { id } = await params;

  return (
    <div className="p-4 md:p-6">
      <ProjectDetail
        projectId={id}
        canEdit
        canManageMembers={hasPermission(roleOf(session.user), "member:manage")}
        // Resolved here, on the server, from the same permission map the API
        // gates the transitions with. The UI hiding a button is a courtesy; the
        // procedure refusing the move is the control.
        canReview={hasPermission(roleOf(session.user), "progress:review")}
        canLock={hasPermission(roleOf(session.user), "progress:lock")}
      />
    </div>
  );
}
