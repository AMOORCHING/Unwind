import { STATUS_COLORS } from "../utils";
export function StatusBadge({ status }) {
    const color = STATUS_COLORS[status] || "#6B6B80";
    return (<span className="inline-block px-2 py-0.5 font-mono text-sm" style={{
            color,
            background: `${color}18`,
            borderRadius: 4,
        }}>
      {status}
    </span>);
}
//# sourceMappingURL=StatusBadge.js.map