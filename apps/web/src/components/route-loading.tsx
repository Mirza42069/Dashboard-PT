import { Skeleton } from "@DashboardV2/ui/components/skeleton";

export default function RouteLoading() {
  return (
    <div aria-busy="true" className="space-y-4 p-4 md:p-6">
      <div aria-hidden="true" className="space-y-4">
        <Skeleton className="h-8 w-48 motion-reduce:animate-none" />
        <Skeleton className="h-[120px] w-full motion-reduce:animate-none" />
        <Skeleton className="h-64 w-full motion-reduce:animate-none" />
      </div>
    </div>
  );
}
