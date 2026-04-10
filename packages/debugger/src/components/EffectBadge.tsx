import type { EffectClass } from "../types";
import { EFFECT_BADGE_STYLES } from "../utils";

interface EffectBadgeProps {
  effectClass: EffectClass;
}

export function EffectBadge({ effectClass }: EffectBadgeProps) {
  const style = EFFECT_BADGE_STYLES[effectClass];
  return (
    <span
      className="inline-block px-1.5 py-0.5 font-mono"
      style={{
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: style.text,
        background: style.bg,
        borderRadius: 4,
        lineHeight: "14px",
      }}
    >
      {effectClass}
    </span>
  );
}
