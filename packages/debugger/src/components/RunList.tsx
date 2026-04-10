import { useState, useMemo } from "react";
import { getRuns, getRunCount } from "../db";
import type { RunStatus, UnwindRun } from "../types";
import { truncateId, relativeTime, STATUS_DOT_COLORS } from "../utils";

interface RunListProps {
  dbFilename: string;
  onReload: () => Promise<void>;
  onChangeFile: () => void;
  onSelectRun: (run: UnwindRun) => void;
}

type FilterTab = "all" | "active" | "failed" | "compensated" | "partially_compensated";

const TABS: { key: FilterTab; label: string; status?: RunStatus }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active", status: "active" },
  { key: "failed", label: "Failed", status: "failed" },
  { key: "compensated", label: "Compensated", status: "compensated" },
  {
    key: "partially_compensated",
    label: "Partial",
    status: "partially_compensated",
  },
];

export function RunList({
  dbFilename,
  onReload,
  onChangeFile,
  onSelectRun,
}: RunListProps) {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [reloading, setReloading] = useState(false);

  const allRuns = useMemo(() => getRuns(), []);

  const tabCounts = useMemo(() => {
    const counts: Record<FilterTab, number> = {
      all: allRuns.length,
      active: 0,
      failed: 0,
      compensated: 0,
      partially_compensated: 0,
    };
    for (const r of allRuns) {
      if (r.status === "active" || r.status === "compensating") counts.active++;
      else if (r.status === "failed") counts.failed++;
      else if (r.status === "compensated") counts.compensated++;
      else if (r.status === "partially_compensated") counts.partially_compensated++;
    }
    return counts;
  }, [allRuns]);

  const filteredRuns = useMemo(() => {
    if (activeTab === "all") return allRuns;
    if (activeTab === "active")
      return allRuns.filter(
        (r) => r.status === "active" || r.status === "compensating"
      );
    return allRuns.filter((r) => r.status === activeTab);
  }, [allRuns, activeTab]);

  const handleReload = async () => {
    setReloading(true);
    await onReload();
    setReloading(false);
  };

  const toolCallCount = (run: UnwindRun) =>
    run.events.filter((e) => e.type === "ToolCallTracked").length;

  return (
    <div className="flex flex-col h-screen" style={{ background: "#0A0A0F" }}>
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid #1E1E2E" }}
      >
        <div className="flex items-center gap-4">
          <span
            className="font-mono text-sm"
            style={{ color: "#6B6B80" }}
          >
            unwind
          </span>
          <span className="text-sm" style={{ color: "#6B6B80" }}>
            {dbFilename} — {allRuns.length} runs
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleReload}
            className="font-mono text-sm px-3 py-1"
            style={{
              color: "#E2E2E8",
              background: "#12121A",
              border: "1px solid #1E1E2E",
              borderRadius: "4px",
              cursor: "pointer",
              transition: "background-color 120ms ease",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "#10101A")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "#12121A")
            }
          >
            {reloading ? "…" : "Reload"}
          </button>
          <button
            onClick={onChangeFile}
            className="text-sm"
            style={{
              color: "#7C8AFF",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            Change file
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div
        className="flex gap-0 px-4"
        style={{ borderBottom: "1px solid #1E1E2E" }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-4 py-2 text-sm relative"
            style={{
              color: activeTab === tab.key ? "#E2E2E8" : "#6B6B80",
              background: "none",
              border: "none",
              cursor: "pointer",
              transition: "color 120ms ease",
            }}
          >
            {tab.label} ({tabCounts[tab.key]})
            {activeTab === tab.key && (
              <div
                className="absolute bottom-0 left-0 right-0 h-px"
                style={{ background: "#7C8AFF" }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Run table */}
      <div className="flex-1 overflow-y-auto">
        {filteredRuns.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <span style={{ color: "#6B6B80" }}>No runs found</span>
          </div>
        ) : (
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid #1E1E2E",
                  position: "sticky",
                  top: 0,
                  background: "#0A0A0F",
                  zIndex: 1,
                }}
              >
                <th className="text-left px-4 py-2" style={thStyle}>
                  STATUS
                </th>
                <th className="text-left px-4 py-2" style={thStyle}>
                  RUN ID
                </th>
                <th className="text-left px-4 py-2" style={thStyle}>
                  AGENT
                </th>
                <th className="text-right px-4 py-2" style={thStyle}>
                  CALLS
                </th>
                <th className="text-right px-4 py-2" style={thStyle}>
                  CREATED
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => (
                <tr
                  key={run.id}
                  onClick={() => onSelectRun(run)}
                  className="cursor-pointer"
                  style={{
                    borderBottom: "1px solid #1E1E2E",
                    transition: "background-color 120ms ease",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#10101A")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block rounded-full"
                        style={{
                          width: 8,
                          height: 8,
                          background:
                            STATUS_DOT_COLORS[run.status] || "#6B6B80",
                        }}
                      />
                      <span className="text-sm" style={{ color: "#6B6B80" }}>
                        {run.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className="font-mono text-sm"
                      style={{ color: "#E2E2E8" }}
                    >
                      {truncateId(run.id)}
                    </span>
                    {run.parentRunId && (
                      <span
                        className="ml-2 text-sm"
                        style={{ color: "#6B6B80" }}
                      >
                        ↳ from {truncateId(run.parentRunId)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-sm" style={{ color: "#E2E2E8" }}>
                      {run.agentId}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span
                      className="font-mono text-sm"
                      style={{ color: "#6B6B80" }}
                    >
                      {toolCallCount(run)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className="text-sm" style={{ color: "#6B6B80" }}>
                      {relativeTime(run.createdAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#6B6B80",
  fontWeight: 400,
};
