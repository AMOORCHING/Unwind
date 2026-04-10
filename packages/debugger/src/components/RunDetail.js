import { useState, useCallback, useEffect, useMemo } from "react";
import { truncateId, copyToClipboard, EFFECT_EXPLANATIONS, DURATION_BAR_COLORS } from "../utils";
import { EffectBadge } from "./EffectBadge";
import { StatusBadge } from "./StatusBadge";
import { CopyButton } from "./CopyButton";
function buildToolCallRows(events) {
    const rows = new Map();
    for (const e of events) {
        if (e.type === "ToolCallTracked") {
            rows.set(e.toolCallId, { stepIndex: e.stepIndex, tracked: e });
        }
    }
    for (const e of events) {
        switch (e.type) {
            case "ToolCallCompleted": {
                const row = rows.get(e.toolCallId);
                if (row)
                    row.completed = e;
                break;
            }
            case "ToolCallFailed": {
                const row = rows.get(e.toolCallId);
                if (row)
                    row.failed = e;
                break;
            }
            case "CompensationStarted": {
                const row = rows.get(e.compensatingToolCallId);
                if (row)
                    row.compensationStarted = e;
                break;
            }
            case "CompensationCompleted": {
                const row = rows.get(e.compensatingToolCallId);
                if (row)
                    row.compensationCompleted = e;
                break;
            }
            case "CompensationFailed": {
                const row = rows.get(e.compensatingToolCallId);
                if (row)
                    row.compensationFailed = e;
                break;
            }
        }
    }
    return Array.from(rows.values()).sort((a, b) => a.stepIndex - b.stepIndex);
}
function getCompensationSummaryLine(rows) {
    const effectful = rows.filter((r) => r.tracked.effectClass !== "idempotent");
    if (effectful.length === 0)
        return null;
    const compensated = effectful.filter((r) => r.compensationCompleted).length;
    const uncompensatable = effectful.filter((r) => r.compensationFailed &&
        r.compensationFailed.reason !== "compensation_action_failed").length;
    const failed = effectful.filter((r) => r.compensationFailed &&
        r.compensationFailed.reason === "compensation_action_failed").length;
    if (compensated === 0 && uncompensatable === 0 && failed === 0)
        return null;
    return `${compensated} of ${effectful.length} effectful calls compensated · ${uncompensatable} uncompensatable · ${failed} failed`;
}
export function RunDetail({ run, onBack, onNavigateToRun }) {
    const [selectedIdx, setSelectedIdx] = useState(null);
    const [forkStep, setForkStep] = useState(0);
    const rows = useMemo(() => buildToolCallRows(run.events), [run.events]);
    const maxDuration = useMemo(() => Math.max(1, ...rows.map((r) => r.completed?.durationMs ?? r.compensationCompleted?.durationMs ?? 0)), [rows]);
    const compensationLine = useMemo(() => {
        if (run.status !== "compensated" &&
            run.status !== "partially_compensated")
            return null;
        return getCompensationSummaryLine(rows);
    }, [run.status, rows]);
    const selectedRow = selectedIdx !== null ? rows.find((r) => r.stepIndex === selectedIdx) : null;
    const completedStepIndices = useMemo(() => rows.filter((r) => r.completed).map((r) => r.stepIndex), [rows]);
    useEffect(() => {
        if (completedStepIndices.length > 0) {
            setForkStep(completedStepIndices[completedStepIndices.length - 1]);
        }
    }, [completedStepIndices]);
    const handleKeyDown = useCallback((e) => {
        if (rows.length === 0)
            return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIdx((prev) => {
                if (prev === null)
                    return rows[0].stepIndex;
                const currentRowIdx = rows.findIndex((r) => r.stepIndex === prev);
                const next = currentRowIdx + 1;
                return next < rows.length ? rows[next].stepIndex : prev;
            });
        }
        else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIdx((prev) => {
                if (prev === null)
                    return rows[rows.length - 1].stepIndex;
                const currentRowIdx = rows.findIndex((r) => r.stepIndex === prev);
                const next = currentRowIdx - 1;
                return next >= 0 ? rows[next].stepIndex : prev;
            });
        }
        else if (e.key === "Escape") {
            setSelectedIdx(null);
        }
    }, [rows]);
    return (<div className="flex flex-col h-screen" style={{ background: "#0A0A0F" }} onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 gap-4 flex-wrap" style={{ borderBottom: "1px solid #1E1E2E", background: "#12121A" }}>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={onBack} style={{
            color: "#6B6B80",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            padding: "0 4px",
        }}>
            ←
          </button>
          <span className="font-mono text-sm cursor-pointer" style={{ color: "#E2E2E8" }} onClick={() => copyToClipboard(run.id)} title="Click to copy full ID">
            {truncateId(run.id)}
          </span>
          <span className="text-sm" style={{ color: "#6B6B80" }}>
            {run.agentId}
          </span>
          <StatusBadge status={run.status}/>
          {run.parentRunId && (<span className="text-sm" style={{ color: "#6B6B80" }}>
              forked from{" "}
              <button onClick={() => onNavigateToRun(run.parentRunId)} className="font-mono" style={{
                color: "#7C8AFF",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontSize: "inherit",
            }}>
                {truncateId(run.parentRunId)}
              </button>
            </span>)}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {run.status === "failed" && (<CopyButton text={`unwind compensate ${run.id}`} label={`unwind compensate ${truncateId(run.id)}`}/>)}
          {completedStepIndices.length > 0 && (<div className="flex items-center gap-1">
              <span className="font-mono text-sm px-2 py-1" style={{
                color: "#E2E2E8",
                background: "#08080D",
                border: "1px solid #1E1E2E",
                borderRadius: "4px 0 0 4px",
                whiteSpace: "nowrap",
            }}>
                unwind fork {truncateId(run.id)} --from-step
              </span>
              <select value={forkStep} onChange={(e) => setForkStep(Number(e.target.value))} className="font-mono text-sm py-1 px-1" style={{
                color: "#E2E2E8",
                background: "#08080D",
                border: "1px solid #1E1E2E",
                borderRadius: 0,
                cursor: "pointer",
                outline: "none",
            }}>
                {completedStepIndices.map((idx) => (<option key={idx} value={idx}>
                    {idx}
                  </option>))}
              </select>
              <button onClick={() => copyToClipboard(`unwind fork ${run.id} --from-step ${forkStep}`)} className="font-mono text-sm px-2 py-1" style={{
                color: "#E2E2E8",
                background: "#08080D",
                border: "1px solid #1E1E2E",
                borderRadius: "0 4px 4px 0",
                cursor: "pointer",
                whiteSpace: "nowrap",
            }}>
                copy
              </button>
            </div>)}
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 overflow-hidden detail-panels">
        {/* Left panel — Effect Timeline */}
        <div className="overflow-y-auto" style={{
            flex: selectedRow ? "0 0 60%" : "1 1 100%",
            padding: 16,
            borderRight: selectedRow ? "1px solid #1E1E2E" : "none",
            transition: "flex 0ms",
        }}>
          {compensationLine && (<div className="mb-4 text-sm" style={{ color: "#6B6B80" }}>
              {compensationLine}
            </div>)}

          <div className="flex flex-col" style={{ gap: 8 }}>
            {rows.map((row) => {
            const isSelected = selectedIdx === row.stepIndex;
            const isReplayed = run.forkFromStep !== undefined &&
                row.stepIndex < run.forkFromStep;
            const outcome = row.completed
                ? row.compensationCompleted
                    ? "compensated"
                    : "completed"
                : "failed";
            const duration = row.completed?.durationMs ?? 0;
            const barPct = maxDuration > 0 ? (duration / maxDuration) * 100 : 0;
            const barColor = isReplayed
                ? "rgba(58,58,68,0.6)"
                : DURATION_BAR_COLORS[outcome] || "#2D6A4F";
            return (<div key={row.tracked.toolCallId}>
                  <div onClick={() => setSelectedIdx(isSelected ? null : row.stepIndex)} className="cursor-pointer flex flex-col px-2 py-2" style={{
                    opacity: isReplayed ? 0.5 : 1,
                    background: isSelected ? "#14141E" : "transparent",
                    borderLeft: isSelected
                        ? "3px solid #7C8AFF"
                        : "3px solid transparent",
                    transition: "background-color 120ms ease",
                }} onMouseEnter={(e) => {
                    if (!isSelected)
                        e.currentTarget.style.background = "#10101A";
                }} onMouseLeave={(e) => {
                    if (!isSelected)
                        e.currentTarget.style.background = "transparent";
                }}>
                    <div className="flex items-center">
                      <span className="font-mono" style={{
                    width: 40,
                    flexShrink: 0,
                    color: "#6B6B80",
                    fontSize: 14,
                }}>
                        #{row.stepIndex}
                      </span>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span style={{
                    color: "#E2E2E8",
                    fontWeight: 500,
                    fontSize: 14,
                }}>
                          {row.tracked.toolName}
                        </span>
                        <EffectBadge effectClass={row.tracked.effectClass}/>
                        {isReplayed && (<span className="inline-block px-1.5 py-0.5 font-mono" style={{
                        fontSize: 10,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "#6B6B80",
                        background: "#1A1A24",
                        borderRadius: 4,
                        lineHeight: "14px",
                    }}>
                            replayed
                          </span>)}
                      </div>
                      <span className="font-mono text-right" style={{
                    width: 120,
                    flexShrink: 0,
                    color: "#6B6B80",
                    fontSize: 14,
                }}>
                        {duration > 0 ? `${duration}ms` : "—"}
                      </span>
                    </div>

                    {/* Duration bar */}
                    <div className="flex items-center mt-1.5" style={{ paddingLeft: 40 }}>
                      <div style={{
                    flex: 1,
                    height: 6,
                    background: "#1A1A24",
                    borderRadius: 9999,
                    overflow: "hidden",
                }}>
                        <div style={{
                    width: `${barPct}%`,
                    height: "100%",
                    background: barColor,
                    borderRadius: 9999,
                    minWidth: duration > 0 ? 4 : 0,
                }}/>
                      </div>
                    </div>
                  </div>

                  {/* Compensation sub-row */}
                  {row.compensationCompleted && (<CompensationSubRow borderColor="#2D6A4F" text={`↳ compensated: ${row.compensationStarted?.compensationAction ?? "unknown"}`} durationMs={row.compensationCompleted.durationMs}/>)}
                  {row.compensationFailed &&
                    row.compensationFailed.reason ===
                        "append_only_no_compensation" && (<CompensationSubRow borderColor="#9A7B2F" text="↳ cannot be undone"/>)}
                  {row.compensationFailed &&
                    row.compensationFailed.reason ===
                        "destructive_escalation" && (<CompensationSubRow borderColor="#9A7B2F" text="↳ cannot be undone"/>)}
                  {row.compensationFailed &&
                    row.compensationFailed.reason ===
                        "compensation_action_failed" && (<CompensationSubRow borderColor="#9B3A3A" text={`↳ compensation failed: ${truncateStr(row.compensationFailed.detail, 80)}`}/>)}
                </div>);
        })}
          </div>
        </div>

        {/* Right panel — Detail Inspector */}
        {selectedRow && (<div className="overflow-y-auto" style={{
                flex: "0 0 40%",
                padding: 16,
                background: "#12121A",
            }}>
            <Inspector row={selectedRow} run={run} onNavigateToRun={onNavigateToRun}/>
          </div>)}
      </div>

      <style>{`
        @media (max-width: 768px) {
          .detail-panels {
            flex-direction: column !important;
          }
          .detail-panels > div {
            flex: none !important;
            border-right: none !important;
            border-bottom: 1px solid #1E1E2E;
          }
        }
      `}</style>
    </div>);
}
function CompensationSubRow({ borderColor, text, durationMs, }) {
    return (<div className="flex items-center" style={{
            paddingLeft: 48,
            paddingRight: 8,
            paddingTop: 4,
            paddingBottom: 4,
            borderLeft: `2px solid ${borderColor}`,
            marginLeft: 48,
        }}>
      <span className="flex-1" style={{ color: "#6B6B80", fontSize: 12 }}>
        {text}
      </span>
      {durationMs !== undefined && (<span className="font-mono" style={{ width: 120, textAlign: "right", color: "#6B6B80", fontSize: 12 }}>
          {durationMs}ms
        </span>)}
    </div>);
}
function Inspector({ row, run, onNavigateToRun, }) {
    return (<div className="flex flex-col gap-6">
      {/* TOOL CALL */}
      <Section label="TOOL CALL">
        <div className="flex items-center gap-2 mb-1">
          <span style={{ fontSize: 16, fontWeight: 500, color: "#E2E2E8" }}>
            {row.tracked.toolName}
          </span>
          <EffectBadge effectClass={row.tracked.effectClass}/>
        </div>
        <div className="text-sm mb-3" style={{ color: "#6B6B80" }}>
          {EFFECT_EXPLANATIONS[row.tracked.effectClass]}
        </div>
        <div style={{ height: 1, background: "#1E1E2E" }} className="mb-3"/>

        <SectionLabel>ARGUMENTS</SectionLabel>
        <JsonBlock data={row.tracked.args} stableArgs={row.tracked.stableArgs}/>

        <SectionLabel>IDEMPOTENCY KEY</SectionLabel>
        <span className="font-mono cursor-pointer block mb-3" style={{ fontSize: 11, color: "#6B6B80" }} onClick={() => copyToClipboard(row.tracked.idempotencyKey)} title="Click to copy">
          {row.tracked.idempotencyKey}
        </span>

        <SectionLabel>RESULT</SectionLabel>
        {row.completed ? (<>
            <JsonBlock data={row.completed.result}/>
            <span className="font-mono mt-1 inline-block" style={{ color: "#6B6B80", fontSize: 12 }}>
              {row.completed.durationMs}ms
            </span>
          </>) : row.failed ? (<div style={{ color: "#C05B5B", fontSize: 14 }}>
            {row.failed.reason}: {String(row.failed.error)}
          </div>) : (<span style={{ color: "#6B6B80" }}>pending</span>)}
      </Section>

      {/* COMPENSATION */}
      {(row.compensationStarted ||
            row.compensationCompleted ||
            row.compensationFailed) && (<Section label="COMPENSATION">
          {row.compensationStarted && (<>
              <div className="text-sm mb-2" style={{ color: "#E2E2E8" }}>
                {row.compensationStarted.compensationAction}
              </div>
              <SectionLabel>ARGUMENTS</SectionLabel>
              <JsonBlock data={row.compensationStarted.args}/>
            </>)}

          {row.compensationCompleted && (<>
              <div className="text-sm mb-1" style={{ color: "#4A8A6A" }}>
                succeeded
              </div>
              <SectionLabel>RESULT</SectionLabel>
              <JsonBlock data={row.compensationCompleted.result}/>
              <span className="font-mono mt-1 inline-block" style={{ color: "#6B6B80", fontSize: 12 }}>
                {row.compensationCompleted.durationMs}ms
              </span>
            </>)}

          {row.compensationFailed && (<>
              <div className="text-sm mb-1" style={{ color: "#C05B5B" }}>
                {row.compensationFailed.reason ===
                    "compensation_action_failed"
                    ? "failed"
                    : "uncompensatable"}
              </div>
              {row.compensationFailed.reason ===
                    "compensation_action_failed" ? (<div style={{ color: "#C05B5B", fontSize: 14 }}>
                  {row.compensationFailed.detail}
                </div>) : (<div className="px-3 py-2 text-sm" style={{
                        borderLeft: "2px solid #9A7B2F",
                        background: "#18160E",
                        color: "#E2E2E8",
                    }}>
                  {row.compensationFailed.detail}
                </div>)}
            </>)}
        </Section>)}

      {/* CONTEXT */}
      <Section label="CONTEXT">
        <ContextLine label="Run ID" value={run.id} mono copyable/>
        <ContextLine label="Agent ID" value={run.agentId}/>
        <ContextLine label="Step index" value={String(row.stepIndex)} mono/>
        {run.parentRunId && run.forkFromStep !== undefined && (<div className="text-sm" style={{ color: "#6B6B80" }}>
            Forked from{" "}
            <button onClick={() => onNavigateToRun(run.parentRunId)} className="font-mono" style={{
                color: "#7C8AFF",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontSize: "inherit",
            }}>
              {truncateId(run.parentRunId)}
            </button>{" "}
            at step {run.forkFromStep}
          </div>)}
      </Section>
    </div>);
}
function Section({ label, children, }) {
    return (<div>
      <div className="mb-2" style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#6B6B80",
            fontWeight: 400,
        }}>
        {label}
      </div>
      {children}
    </div>);
}
function SectionLabel({ children }) {
    return (<div className="mb-1 mt-3" style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#6B6B80",
            fontWeight: 400,
        }}>
      {children}
    </div>);
}
function JsonBlock({ data, stableArgs, }) {
    if (data === undefined || data === null) {
        return (<div className="font-mono p-3 mb-2" style={{ background: "#08080D", color: "#6B6B80", fontSize: 14 }}>
        null
      </div>);
    }
    if (typeof data !== "object") {
        return (<div className="font-mono p-3 mb-2" style={{ background: "#08080D", color: "#E2E2E8", fontSize: 14 }}>
        {JSON.stringify(data, null, 2)}
      </div>);
    }
    const entries = Object.entries(data);
    const stableKeys = stableArgs ? new Set(Object.keys(stableArgs)) : null;
    return (<pre className="font-mono p-3 mb-2 overflow-x-auto" style={{
            background: "#08080D",
            fontSize: 14,
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
        }}>
      {"{\n"}
      {entries.map(([key, val], i) => {
            const isEphemeral = stableKeys && !stableKeys.has(key);
            return (<span key={key} style={{ opacity: isEphemeral ? 0.4 : 1 }}>
            {"  "}
            <span style={{ color: "#E2E2E8" }}>
              "{key}": {formatJsonValue(val)}
            </span>
            {i < entries.length - 1 ? ",\n" : "\n"}
          </span>);
        })}
      {"}"}
    </pre>);
}
function formatJsonValue(val) {
    if (typeof val === "string")
        return `"${val}"`;
    if (val === null || val === undefined)
        return "null";
    if (typeof val === "object")
        return JSON.stringify(val);
    return String(val);
}
function ContextLine({ label, value, mono, copyable, }) {
    return (<div className="flex items-center gap-2 mb-1 text-sm">
      <span style={{ color: "#6B6B80" }}>{label}:</span>
      <span className={mono ? "font-mono" : ""} style={{
            color: "#E2E2E8",
            cursor: copyable ? "pointer" : "default",
        }} onClick={copyable ? () => copyToClipboard(value) : undefined} title={copyable ? "Click to copy" : undefined}>
        {value}
      </span>
    </div>);
}
function truncateStr(s, max) {
    return s.length <= max ? s : s.slice(0, max - 3) + "...";
}
//# sourceMappingURL=RunDetail.js.map