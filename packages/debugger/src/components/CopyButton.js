import { useState, useCallback } from "react";
import { copyToClipboard } from "../utils";
export function CopyButton({ text, label }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(() => {
        copyToClipboard(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [text]);
    return (<button onClick={handleCopy} className="font-mono text-sm px-2 py-1 flex items-center gap-1.5" style={{
            color: copied ? "#4A8A6A" : "#E2E2E8",
            background: "#08080D",
            border: "1px solid #1E1E2E",
            borderRadius: 4,
            cursor: "pointer",
            transition: "color 120ms ease",
            whiteSpace: "nowrap",
        }}>
      {copied ? "✓ copied" : label}
    </button>);
}
//# sourceMappingURL=CopyButton.js.map