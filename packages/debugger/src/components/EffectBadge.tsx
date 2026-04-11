import type { EffectClass } from "../types";
import { Badge } from "./ui/badge";

const VARIANT_MAP: Record<
  EffectClass,
  "success" | "info" | "warning" | "destructive"
> = {
  idempotent: "success",
  reversible: "info",
  "append-only": "warning",
  destructive: "destructive",
};

interface EffectBadgeProps {
  effectClass: EffectClass;
}

export function EffectBadge({ effectClass }: EffectBadgeProps) {
  return <Badge variant={VARIANT_MAP[effectClass]}>{effectClass}</Badge>;
}
