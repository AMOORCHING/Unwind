import type { RunStatus } from "../types";
import { STATUS_COLORS } from "../utils";

interface StatusBadgeProps {
  status: RunStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const color = STATUS_COLORS[status] || "#6B6B80";

  return (
    <span
      className="inline-block px-2 py-0.5 font-mono text-sm"
      style={{
        color,
        background: `${color}18`,
        borderRadius: 4,
      }}
    >
      {status}
    </span>
  );
}
