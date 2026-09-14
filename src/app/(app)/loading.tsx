import { ListSkeleton } from "@/components/ui/separator";

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="bg-muted h-6 w-32 animate-pulse rounded-md" />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-card bg-muted h-24 animate-pulse" />
        ))}
      </div>
      <ListSkeleton rows={4} />
    </div>
  );
}
