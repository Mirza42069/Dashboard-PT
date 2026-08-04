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
  const session = await requireSession();
  const role = roleOf(session.user);
  const { id } = await params;

  return (
    <div className="p-4 md:p-6">
      <ProjectDetail
        projectId={id}
        currentUserId={session.user.id}
        canUpdateProject={hasPermission(role, "project:update")}
        canWrite={hasPermission(role, "project:write")}
        canManageMembers={hasPermission(role, "member:manage")}
        // Resolved here, on the server, from the same permission map the API
        // gates the transitions with. The UI hiding a button is a courtesy; the
        // procedure refusing the move is the control.
        canReview={hasPermission(role, "progress:review")}
        canLock={hasPermission(role, "progress:lock")}
      />
    </div>
  );
}
