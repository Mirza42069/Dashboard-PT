import { Card, CardContent, CardDescription, CardHeader } from "@DashboardV2/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@DashboardV2/ui/components/empty";
import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";

import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Dashboard · DashboardV2",
};

/** Placeholders until the company's real metrics land in a later phase. */
const STATS = [
  { label: "Revenue (MTD)", value: "—", hint: "Not connected yet" },
  { label: "Active projects", value: "—", hint: "Not connected yet" },
  { label: "Open tasks", value: "—", hint: "Not connected yet" },
  { label: "Team members", value: "—", hint: "Not connected yet" },
];

export default async function DashboardPage() {
  const session = await requireSession();

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">
          Welcome back, {session.user.name.split(" ")[0]}
        </h1>
        <p className="text-xs text-muted-foreground">
          Here&apos;s what&apos;s happening across the company.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {STATS.map((stat) => (
          <Card key={stat.label} size="sm">
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-2xl font-semibold tabular-nums">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="min-h-80">
        <CardContent className="flex flex-1">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BarChart3 />
              </EmptyMedia>
              <EmptyTitle>No data sources connected</EmptyTitle>
              <EmptyDescription>
                Company metrics and charts arrive in the next phase. Account management is available
                now under Administration.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    </div>
  );
}
