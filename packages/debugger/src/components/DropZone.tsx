import { useState, useCallback, useRef } from "react";

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
    <div
      className="flex items-center justify-center w-full h-screen"
      style={{ background: "#0A0A0F" }}
    >
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="flex flex-col items-center justify-center gap-3 px-16 py-20 cursor-pointer"
        style={{
          border: `2px dashed ${dragging ? "#7C8AFF" : "#1E1E2E"}`,
          transition: "border-color 120ms ease",
        }}
        onClick={onPickFile}
      >
        {loading ? (
          <span style={{ color: "#6B6B80" }}>Loading…</span>
        ) : (
          <>
            <span
              className="font-mono text-lg"
              style={{ color: "#E2E2E8" }}
            >
              Drop unwind.db here
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPickFile();
              }}
              className="font-mono text-sm"
              style={{
                color: "#7C8AFF",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              or choose file
            </button>
          </>
        )}
        {error && (
          <span className="text-sm mt-2" style={{ color: "#C05B5B" }}>
            {error}
          </span>
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
