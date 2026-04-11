import { useState, useCallback, useRef } from "react";
import { Database, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

interface DropZoneProps {
  onFileLoaded: (file: File) => Promise<void>;
}

export function DropZone({ onFileLoaded }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setError(null);
      try {
        await onFileLoaded(file);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load database");
      } finally {
        setLoading(false);
      }
    },
    [onFileLoaded]
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!dragging) setDragging(true);
    },
    [dragging]
  );

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onPickFile = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="relative flex flex-col items-center justify-center w-full h-screen bg-uw-bg overflow-hidden">
      {/* Background glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 600px 400px at 50% 45%, hsl(233 94% 67% / 0.06), transparent)",
        }}
      />

      {/* Wordmark */}
      <div className="relative mb-10 flex flex-col items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight text-uw-text">
          Unwind Debugger
        </h1>
        <p className="text-sm text-uw-muted">
          Inspect runs, tool calls, and compensations
        </p>
      </div>

      {/* Drop area */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onPickFile}
        className={cn(
          "relative flex flex-col items-center justify-center gap-4 w-[420px] py-16 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200",
          dragging
            ? "border-uw-accent bg-uw-accent/5 shadow-uw-glow animate-pulse-border"
            : "border-uw-border hover:border-uw-muted hover:bg-uw-surface/50"
        )}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 text-uw-accent animate-spin" />
            <span className="text-sm text-uw-text-secondary">
              Loading database...
            </span>
          </div>
        ) : (
          <>
            <div
              className={cn(
                "flex items-center justify-center w-14 h-14 rounded-xl transition-colors",
                dragging
                  ? "bg-uw-accent/10 text-uw-accent"
                  : "bg-uw-surface text-uw-muted"
              )}
            >
              <Database className="h-7 w-7" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-base font-medium text-uw-text">
                Drop unwind.db here
              </span>
              <span className="text-sm text-uw-muted">
                or{" "}
                <Button
                  variant="link"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPickFile();
                  }}
                  className="text-sm px-0 h-auto"
                >
                  browse files
                </Button>
              </span>
            </div>
            <span className="text-2xs text-uw-muted mt-1">
              Supports .db, .sqlite, .sqlite3
            </span>
          </>
        )}
        {error && (
          <div className="flex items-center gap-2 mt-2 px-3 py-1.5 rounded-md bg-red-500/10 border border-red-500/20">
            <span className="text-sm text-uw-error">{error}</span>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".db,.sqlite,.sqlite3"
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  );
}
