import type { UnwindEvent, UnwindRun } from "./types";
export declare function initDB(file: File | ArrayBuffer): Promise<void>;
export declare function closeDB(): void;
export declare function isOpen(): boolean;
export declare function getRuns(filter?: {
    status?: string;
}): UnwindRun[];
export declare function getRun(id: string): UnwindRun | null;
export declare function getEvents(runId: string): UnwindEvent[];
export declare function getRunCount(filter?: {
    status?: string;
}): number;
//# sourceMappingURL=db.d.ts.map