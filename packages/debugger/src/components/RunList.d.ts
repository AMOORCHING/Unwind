import type { UnwindRun } from "../types";
interface RunListProps {
    dbFilename: string;
    onReload: () => Promise<void>;
    onChangeFile: () => void;
    onSelectRun: (run: UnwindRun) => void;
}
export declare function RunList({ dbFilename, onReload, onChangeFile, onSelectRun, }: RunListProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=RunList.d.ts.map