import type { UnwindRun } from "../types";
interface RunDetailProps {
    run: UnwindRun;
    onBack: () => void;
    onNavigateToRun: (runId: string) => void;
}
export declare function RunDetail({ run, onBack, onNavigateToRun }: RunDetailProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=RunDetail.d.ts.map