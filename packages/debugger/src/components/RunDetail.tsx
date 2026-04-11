import { useState, useCallback, useEffect, useMemo } from "react";
import { ArrowLeft, Copy, GitFork, AlertTriangle } from "lucide-react";
import type {
  UnwindRun,
  UnwindEvent,
  ToolCallTracked,
  ToolCallCompleted,
  ToolCallFailed,
  CompensationStarted,
  CompensationCompleted,
  CompensationFailed,
  EffectClass,
} from "../types";
import {
  truncateId,
  copyToClipboard,
  EFFECT_EXPLANATIONS,
  DURATION_BAR_COLORS,
} from "../utils";
import { cn } from "../lib/utils";
import { EffectBadge } from "./EffectBadge";
import { StatusBadge } from "./StatusBadge";
import { CopyButton } from "./CopyButton";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui/tooltip";

interface RunDetailProps {
  run: UnwindRun;
  onBack: () => void;
  onNavigateToRun: (runId: string) => void;
}

interface ToolCallRow {
  stepIndex: number;
  tracked: ToolCallTracked;
  completed?: ToolCallCompleted;
  failed?: ToolCallFailed;
  compensationStarted?: CompensationStarted;
  compensationCompleted?: CompensationCompleted;
  compensationFailed?: CompensationFailed;
}

function buildToolCallRows(events: UnwindEvent[]): ToolCallRow[] {
  const rows = new Map<string, ToolCallRow>();

  for (const e of events) {
    if (e.type === "ToolCallTracked") {
      rows.set(e.toolCallId, { stepIndex: e.stepIndex, tracked: e });
    }
  }

  for (const e of events) {
    switch (e.type) {
      case "ToolCallCompleted": {
        const row = rows.get(e.toolCallId);
        if (row) row.completed = e;
        break;
      }
      case "ToolCallFailed": {
        const row = rows.get(e.toolCallId);
        if (row) row.failed = e;
        break;
      }
      case "CompensationStarted": {
        const row = rows.get(e.compensatingToolCallId);
        if (row) row.compensationStarted = e;
        break;
      }
      case "CompensationCompleted": {
        const row = rows.get(e.compensatingToolCallId);
        if (row) row.compensationCompleted = e;
        break;
      }
      case "CompensationFailed": {
        const row = rows.get(e.compensatingToolCallId);
        if (row) row.compensationFailed = e;
        break;
      }
    }
  }

  return Array.from(rows.values()).sort((a, b) => a.stepIndex - b.stepIndex);
}

function getCompensationSummaryLine(rows: ToolCallRow[]): string | null {
  const effectful = rows.filter(
    (r) => r.tracked.effectClass !== "idempotent"
  );
  if (effectful.length === 0) return null;

  const compensated = effectful.filter((r) => r.compensationCompleted).length;
  const uncompensatable = effectful.filter(
    (r) =>
      r.compensationFailed &&
      r.compensationFailed.reason !== "compensation_action_failed"
  ).length;
  const failed = effectful.filter(
    (r) =>
      r.compensationFailed &&
      r.compensationFailed.reason === "compensation_action_failed"
  ).length;

  if (compensated === 0 && uncompensatable === 0 && failed === 0) return null;

  return `${compensated} of ${effectful.length} effectful calls compensated · ${uncompensatable} uncompensatable · ${failed} failed`;
}

export function RunDetail({ run, onBack, onNavigateToRun }: RunDetailProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [forkStep, setForkStep] = useState<string>("0");

  const rows = useMemo(() => buildToolCallRows(run.events), [run.events]);
  const maxDuration = useMemo(
    () =>
      Math.max(
        1,
        ...rows.map(
          (r) =>
            r.completed?.durationMs ?? r.compensationCompleted?.durationMs ?? 0
        )
      ),
    [rows]
  );

  const compensationLine = useMemo(() => {
    if (
      run.status !== "compensated" &&
      run.status !== "partially_compensated"
    )
      return null;
    return getCompensationSummaryLine(rows);
  }, [run.status, rows]);

  const selectedRow =
    selectedIdx !== null
      ? rows.find((r) => r.stepIndex === selectedIdx)
      : null;

  const completedStepIndices = useMemo(
    () => rows.filter((r) => r.completed).map((r) => r.stepIndex),
    [rows]
  );

  useEffect(() => {
    if (completedStepIndices.length > 0) {
      setForkStep(
        String(completedStepIndices[completedStepIndices.length - 1])
      );
    }
  }, [completedStepIndices]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (rows.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((prev) => {
          if (prev === null) return rows[0].stepIndex;
          const currentRowIdx = rows.findIndex((r) => r.stepIndex === prev);
          const next = currentRowIdx + 1;
          return next < rows.length ? rows[next].stepIndex : prev;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((prev) => {
          if (prev === null) return rows[rows.length - 1].stepIndex;
          const currentRowIdx = rows.findIndex((r) => r.stepIndex === prev);
          const next = currentRowIdx - 1;
          return next >= 0 ? rows[next].stepIndex : prev;
        });
      } else if (e.key === "Escape") {
        setSelectedIdx(null);
      }
    },
    [rows]
  );

  return (
    <div
      className="flex flex-col h-screen bg-uw-bg"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 gap-4 flex-wrap bg-uw-surface border-b border-uw-border shadow-uw-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="font-mono text-sm font-medium text-uw-text cursor-pointer hover:text-uw-accent transition-colors"
                onClick={() => copyToClipboard(run.id)}
              >
                {truncateId(run.id)}
              </span>
            </TooltipTrigger>
            <TooltipContent>Click to copy full ID</TooltipContent>
          </Tooltip>

          <span className="text-sm text-uw-muted">{run.agentId}</span>
          <StatusBadge status={run.status} />

          {run.parentRunId && (
            <span className="text-sm text-uw-muted flex items-center gap-1.5">
              <GitFork className="h-3 w-3" />
              from{" "}
              <button
                onClick={() => onNavigateToRun(run.parentRunId!)}
                className="font-mono text-uw-accent hover:underline"
              >
                {truncateId(run.parentRunId)}
              </button>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {run.status === "failed" && (
            <CopyButton
              text={`unwind compensate ${run.id}`}
              label={`unwind compensate ${truncateId(run.id)}`}
            />
          )}
          {completedStepIndices.length > 0 && (
            <div className="flex items-center rounded-md shadow-uw-sm overflow-hidden">
              <span className="font-mono text-xs px-3 py-1.5 text-uw-text-secondary bg-uw-input border border-uw-border whitespace-nowrap rounded-l-md">
                unwind fork {truncateId(run.id)} --from-step
              </span>
              <Select value={forkStep} onValueChange={setForkStep}>
                <SelectTrigger className="w-14 rounded-none border-x-0 shadow-none h-[30px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {completedStepIndices.map((idx) => (
                    <SelectItem key={idx} value={String(idx)}>
                      {idx}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="rounded-l-none border-l-0 gap-1.5 shadow-none h-[30px]"
                onClick={() =>
                  copyToClipboard(
                    `unwind fork ${run.id} --from-step ${forkStep}`
                  )
                }
              >
                <Copy className="h-3 w-3" />
                copy
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Compensation summary banner */}
      {compensationLine && (
        <div className="flex items-center gap-2 px-5 py-2 bg-amber-500/5 border-b border-amber-500/10 text-sm text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {compensationLine}
        </div>
      )}

      {/* Two-panel layout */}
      <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
        {/* Left panel -- Effect Timeline */}
        <ScrollArea
          className={cn(
            "p-4",
            selectedRow
              ? "md:w-[58%] border-b md:border-b-0 md:border-r border-uw-border"
              : "w-full"
          )}
        >
          <div className="flex flex-col gap-2">
            {rows.map((row) => {
              const isSelected = selectedIdx === row.stepIndex;
              const isReplayed =
                run.forkFromStep !== undefined &&
                row.stepIndex < run.forkFromStep;
              const outcome = row.completed
                ? row.compensationCompleted
                  ? "compensated"
                  : "completed"
                : "failed";
              const duration = row.completed?.durationMs ?? 0;
              const barPct =
                maxDuration > 0 ? (duration / maxDuration) * 100 : 0;
              const barColor = isReplayed
                ? "rgba(58,58,68,0.6)"
                : DURATION_BAR_COLORS[outcome] || "#2D6A4F";

              return (
                <div key={row.tracked.toolCallId} className="animate-fade-in">
                  <div
                    onClick={() =>
                      setSelectedIdx(isSelected ? null : row.stepIndex)
                    }
                    className={cn(
                      "cursor-pointer flex flex-col px-3 py-3 rounded-lg border transition-all duration-150",
                      isSelected
                        ? "bg-uw-selected border-uw-accent/30 shadow-uw-glow"
                        : "bg-uw-surface/40 border-transparent hover:bg-uw-surface hover:border-uw-border-subtle",
                      isReplayed && "opacity-40"
                    )}
                  >
                    <div className="flex items-center">
                      <span className="font-mono w-10 shrink-0 text-uw-muted text-sm tabular-nums">
                        #{row.stepIndex}
                      </span>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-uw-text font-medium text-sm">
                          {row.tracked.toolName}
                        </span>
                        <EffectBadge effectClass={row.tracked.effectClass} />
                        {isReplayed && (
                          <Badge variant="default">replayed</Badge>
                        )}
                      </div>
                      <span className="font-mono w-[100px] shrink-0 text-right text-uw-muted text-sm tabular-nums">
                        {duration > 0 ? `${duration}ms` : "\u2014"}
                      </span>
                    </div>

                    {/* Duration bar */}
                    <div className="flex items-center mt-2.5 pl-10">
                      <div className="flex-1 h-1 bg-uw-bg rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${barPct}%`,
                            background: barColor,
                            minWidth: duration > 0 ? 4 : 0,
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Compensation sub-rows */}
                  {row.compensationCompleted && (
                    <CompensationSubRow
                      variant="success"
                      text={`compensated: ${row.compensationStarted?.compensationAction ?? "unknown"}`}
                      durationMs={row.compensationCompleted.durationMs}
                    />
                  )}
                  {row.compensationFailed &&
                    row.compensationFailed.reason ===
                      "append_only_no_compensation" && (
                      <CompensationSubRow
                        variant="warning"
                        text="cannot be undone"
                      />
                    )}
                  {row.compensationFailed &&
                    row.compensationFailed.reason ===
                      "destructive_escalation" && (
                      <CompensationSubRow
                        variant="warning"
                        text="cannot be undone"
                      />
                    )}
                  {row.compensationFailed &&
                    row.compensationFailed.reason ===
                      "compensation_action_failed" && (
                      <CompensationSubRow
                        variant="error"
                        text={`compensation failed: ${truncateStr(row.compensationFailed.detail, 80)}`}
                      />
                    )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Right panel -- Detail Inspector */}
        {selectedRow && (
          <ScrollArea className="md:w-[42%] bg-uw-surface/30 p-4">
            <Inspector
              row={selectedRow}
              run={run}
              onNavigateToRun={onNavigateToRun}
            />
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

const COMP_COLORS: Record<string, { border: string; dot: string }> = {
  success: { border: "border-l-emerald-500/50", dot: "bg-emerald-400" },
  warning: { border: "border-l-amber-500/50", dot: "bg-amber-400" },
  error: { border: "border-l-red-500/50", dot: "bg-red-400" },
};

function CompensationSubRow({
  variant,
  text,
  durationMs,
}: {
  variant: "success" | "warning" | "error";
  text: string;
  durationMs?: number;
}) {
  const colors = COMP_COLORS[variant];
  return (
    <div
      className={cn(
        "flex items-center py-1.5 pl-14 pr-3 ml-5 border-l-2",
        colors.border
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full mr-2 shrink-0", colors.dot)}
      />
      <span className="flex-1 text-xs text-uw-muted">{text}</span>
      {durationMs !== undefined && (
        <span className="font-mono w-[100px] text-right text-xs text-uw-muted tabular-nums">
          {durationMs}ms
        </span>
      )}
    </div>
  );
}

function Inspector({
  row,
  run,
  onNavigateToRun,
}: {
  row: ToolCallRow;
  run: UnwindRun;
  onNavigateToRun: (runId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* TOOL CALL */}
      <Card>
        <CardHeader>
          <CardTitle>Tool Call</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-uw-text">
              {row.tracked.toolName}
            </span>
            <EffectBadge effectClass={row.tracked.effectClass} />
          </div>
          <p className="text-xs text-uw-muted leading-relaxed">
            {EFFECT_EXPLANATIONS[row.tracked.effectClass]}
          </p>

          <Separator />

          <div>
            <SectionLabel>Arguments</SectionLabel>
            <JsonBlock
              data={row.tracked.args}
              stableArgs={row.tracked.stableArgs}
            />
          </div>

          <div>
            <SectionLabel>Idempotency Key</SectionLabel>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="font-mono text-2xs text-uw-muted cursor-pointer hover:text-uw-text transition-colors block truncate"
                  onClick={() => copyToClipboard(row.tracked.idempotencyKey)}
                >
                  {row.tracked.idempotencyKey}
                </span>
              </TooltipTrigger>
              <TooltipContent>Click to copy</TooltipContent>
            </Tooltip>
          </div>

          <div>
            <SectionLabel>Result</SectionLabel>
            {row.completed ? (
              <>
                <JsonBlock data={row.completed.result} />
                <span className="font-mono text-2xs text-uw-muted mt-1.5 inline-block tabular-nums">
                  {row.completed.durationMs}ms
                </span>
              </>
            ) : row.failed ? (
              <div className="text-sm text-uw-error px-3 py-2 bg-red-500/5 rounded-md border border-red-500/10">
                {row.failed.reason}: {String(row.failed.error)}
              </div>
            ) : (
              <span className="text-sm text-uw-muted">pending</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* COMPENSATION */}
      {(row.compensationStarted ||
        row.compensationCompleted ||
        row.compensationFailed) && (
        <Card>
          <CardHeader>
            <CardTitle>Compensation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {row.compensationStarted && (
              <>
                <p className="text-sm font-medium text-uw-text">
                  {row.compensationStarted.compensationAction}
                </p>
                <SectionLabel>Arguments</SectionLabel>
                <JsonBlock data={row.compensationStarted.args} />
              </>
            )}

            {row.compensationCompleted && (
              <>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-sm text-emerald-400 font-medium">
                    succeeded
                  </span>
                </div>
                <SectionLabel>Result</SectionLabel>
                <JsonBlock data={row.compensationCompleted.result} />
                <span className="font-mono text-2xs text-uw-muted mt-1 inline-block tabular-nums">
                  {row.compensationCompleted.durationMs}ms
                </span>
              </>
            )}

            {row.compensationFailed && (
              <>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-red-400" />
                  <span className="text-sm text-red-400 font-medium">
                    {row.compensationFailed.reason ===
                    "compensation_action_failed"
                      ? "failed"
                      : "uncompensatable"}
                  </span>
                </div>
                {row.compensationFailed.reason ===
                "compensation_action_failed" ? (
                  <div className="text-sm text-uw-error px-3 py-2 bg-red-500/5 rounded-md border border-red-500/10">
                    {row.compensationFailed.detail}
                  </div>
                ) : (
                  <div className="px-3 py-2 text-sm border-l-2 border-l-amber-500/40 bg-amber-500/5 text-uw-text-secondary rounded-r-md">
                    {row.compensationFailed.detail}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* CONTEXT */}
      <Card>
        <CardHeader>
          <CardTitle>Context</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <ContextLine label="Run ID" value={run.id} mono copyable />
          <ContextLine label="Agent ID" value={run.agentId} />
          <ContextLine
            label="Step index"
            value={String(row.stepIndex)}
            mono
          />
          {run.parentRunId && run.forkFromStep !== undefined && (
            <p className="text-sm text-uw-muted flex items-center gap-1.5">
              <GitFork className="h-3 w-3" />
              Forked from{" "}
              <button
                onClick={() => onNavigateToRun(run.parentRunId!)}
                className="font-mono text-uw-accent hover:underline"
              >
                {truncateId(run.parentRunId)}
              </button>{" "}
              at step {run.forkFromStep}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-2xs uppercase tracking-widest text-uw-muted font-medium mb-2">
      {children}
    </div>
  );
}

function JsonBlock({
  data,
  stableArgs,
}: {
  data: unknown;
  stableArgs?: Record<string, unknown>;
}) {
  if (data === undefined || data === null) {
    return (
      <div className="font-mono p-3 rounded-lg bg-uw-bg text-uw-muted text-sm border border-uw-border-subtle">
        null
      </div>
    );
  }

  if (typeof data !== "object") {
    return (
      <div className="font-mono p-3 rounded-lg bg-uw-bg text-uw-text text-sm border border-uw-border-subtle">
        {JSON.stringify(data, null, 2)}
      </div>
    );
  }

  const entries = Object.entries(data as Record<string, unknown>);
  const stableKeys = stableArgs ? new Set(Object.keys(stableArgs)) : null;

  return (
    <pre className="font-mono p-3 rounded-lg bg-uw-bg text-sm overflow-x-auto whitespace-pre-wrap break-all m-0 border border-uw-border-subtle leading-relaxed">
      {"{\n"}
      {entries.map(([key, val], i) => {
        const isEphemeral = stableKeys && !stableKeys.has(key);
        return (
          <span key={key} className={isEphemeral ? "opacity-30" : ""}>
            {"  "}
            <span className="text-blue-400">"{key}"</span>
            <span className="text-uw-muted">: </span>
            <span className="text-amber-300">{formatJsonValue(val)}</span>
            {i < entries.length - 1 ? ",\n" : "\n"}
          </span>
        );
      })}
      {"}"}
    </pre>
  );
}

function formatJsonValue(val: unknown): string {
  if (typeof val === "string") return `"${val}"`;
  if (val === null || val === undefined) return "null";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function ContextLine({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
}) {
  const valueEl = (
    <span
      className={cn(
        "text-uw-text",
        mono && "font-mono",
        copyable && "cursor-pointer hover:text-uw-accent transition-colors"
      )}
      onClick={copyable ? () => copyToClipboard(value) : undefined}
    >
      {value}
    </span>
  );

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-uw-muted whitespace-nowrap">{label}:</span>
      {copyable ? (
        <Tooltip>
          <TooltipTrigger asChild>{valueEl}</TooltipTrigger>
          <TooltipContent>Click to copy</TooltipContent>
        </Tooltip>
      ) : (
        valueEl
      )}
    </div>
  );
}

function truncateStr(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 3) + "...";
}
