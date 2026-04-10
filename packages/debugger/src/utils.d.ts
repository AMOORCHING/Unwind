import type { EffectClass } from "./types";
export declare function truncateId(id: string, len?: number): string;
export declare function relativeTime(iso: string): string;
export declare function copyToClipboard(text: string): void;
export declare const STATUS_COLORS: Record<string, string>;
export declare const STATUS_DOT_COLORS: Record<string, string>;
export declare const EFFECT_BADGE_STYLES: Record<EffectClass, {
    text: string;
    bg: string;
}>;
export declare const EFFECT_EXPLANATIONS: Record<EffectClass, string>;
export declare const DURATION_BAR_COLORS: Record<string, string>;
//# sourceMappingURL=utils.d.ts.map