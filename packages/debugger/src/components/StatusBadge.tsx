import type { RunStatus } from "../types";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-uw-muted/10 text-uw-text-secondary border-uw-muted/20",
  completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
  compensating: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  compensated: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  partially_compensated: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

interface StatusBadgeProps {
  status: RunStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <Badge
      variant="status"
      className={cn("font-mono", STATUS_STYLES[status])}
    >
      {status.replace("_", " ")}
    </Badge>
  );
}
