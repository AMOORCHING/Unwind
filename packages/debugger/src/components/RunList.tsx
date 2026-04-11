import { useState, useMemo } from "react";
import { RefreshCw, FolderOpen, Inbox } from "lucide-react";
import { getRuns } from "../db";
import type { RunStatus, UnwindRun } from "../types";
import { truncateId, relativeTime } from "../utils";
import { StatusBadge } from "./StatusBadge";
import { Button } from "./ui/button";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { ScrollArea } from "./ui/scroll-area";

interface RunListProps {
  dbFilename: string;
  onReload: () => Promise<void>;
  onChangeFile: () => void;
  onSelectRun: (run: UnwindRun) => void;
}

type FilterTab =
  | "all"
  | "active"
  | "failed"
  | "compensated"
  | "partially_compensated";

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
      else if (r.status === "partially_compensated")
        counts.partially_compensated++;
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
    <div className="flex flex-col h-screen bg-uw-bg">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 bg-uw-surface/50 border-b border-uw-border">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-medium text-uw-text">
            unwind
          </span>
          <span className="text-2xs text-uw-muted px-2 py-0.5 rounded-full bg-uw-surface border border-uw-border-subtle">
            {dbFilename}
          </span>
          <span className="text-sm text-uw-muted">
            {allRuns.length} {allRuns.length === 1 ? "run" : "runs"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleReload}>
            <RefreshCw
              className={`h-3 w-3 mr-1.5 ${reloading ? "animate-spin" : ""}`}
            />
            Reload
          </Button>
          <Button variant="ghost" size="sm" onClick={onChangeFile}>
            <FolderOpen className="h-3 w-3 mr-1.5" />
            Change file
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="border-b border-uw-border-subtle bg-uw-bg">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as FilterTab)}
        >
          <TabsList>
            {TABS.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key}>
                {tab.label}
                <span className="ml-1.5 text-2xs text-uw-muted">
                  {tabCounts[tab.key]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Run table */}
      <ScrollArea className="flex-1">
        {filteredRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Inbox className="h-10 w-10 text-uw-muted/50" />
            <span className="text-sm text-uw-muted">No runs found</span>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent sticky top-0 bg-uw-bg z-10">
                <TableHead className="w-[160px]">Status</TableHead>
                <TableHead>Run ID</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right w-[80px]">Calls</TableHead>
                <TableHead className="text-right w-[100px]">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRuns.map((run) => (
                <TableRow
                  key={run.id}
                  onClick={() => onSelectRun(run)}
                  className="cursor-pointer group"
                >
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm font-medium text-uw-text group-hover:text-uw-accent transition-colors">
                      {truncateId(run.id)}
                    </span>
                    {run.parentRunId && (
                      <span className="ml-2 text-2xs text-uw-muted">
                        ↳ from {truncateId(run.parentRunId)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-uw-text-secondary">
                      {run.agentId}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono text-sm text-uw-muted tabular-nums">
                      {toolCallCount(run)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm text-uw-muted">
                      {relativeTime(run.createdAt)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ScrollArea>
    </div>
  );
}
