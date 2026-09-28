import { Skeleton } from "@houston-ai/core";

export function AgentDelegationSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card"
    >
      <div className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <Skeleton className="h-5 w-36 rounded-md" />
        <Skeleton className="h-11 w-full rounded-lg md:h-9 md:w-48" />
      </div>
      <div className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <Skeleton className="h-5 w-36 rounded-md" />
        <Skeleton className="h-11 w-full rounded-lg md:h-9 md:w-48" />
      </div>
    </div>
  );
}
