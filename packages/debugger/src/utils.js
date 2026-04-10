export function truncateId(id, len = 8) {
    return id.slice(0, len);
}
export function relativeTime(iso) {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diff = now - then;
    if (diff < 0)
        return "just now";
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60)
        return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
export function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
    });
}
export const STATUS_COLORS = {
    active: "#6B6B80",
    completed: "#4A8A6A",
    failed: "#C05B5B",
    compensating: "#B89A3F",
    compensated: "#B89A3F",
    partially_compensated: "#B89A3F",
};
export const STATUS_DOT_COLORS = {
    active: "#6B6B80",
    completed: "#4A8A6A",
    failed: "#C05B5B",
    compensating: "#B89A3F",
    compensated: "#B89A3F",
    partially_compensated: "#B89A3F",
};
export const EFFECT_BADGE_STYLES = {
    idempotent: { text: "#2D6A4F", bg: "#1A3A2A" },
    reversible: { text: "#5B7DC0", bg: "#1A2A4A" },
    "append-only": { text: "#B89A3F", bg: "#2A2418" },
    destructive: { text: "#C05B5B", bg: "#2A1A1A" },
};
export const EFFECT_EXPLANATIONS = {
    idempotent: "idempotent — safe to retry, no compensation needed",
    reversible: "reversible — compensation action defined",
    "append-only": "append-only — cannot be undone",
    destructive: "destructive — requires approval, human escalation on failure",
};
export const DURATION_BAR_COLORS = {
    completed: "#2D6A4F",
    failed: "#9B3A3A",
    compensated: "#9A7B2F",
};
//# sourceMappingURL=utils.js.map