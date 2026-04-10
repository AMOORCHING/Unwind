import { useState, useCallback, useRef, useEffect } from "react";
import { initDB, closeDB, getRun } from "./db";
import { DropZone } from "./components/DropZone";
import { RunList } from "./components/RunList";
import { RunDetail } from "./components/RunDetail";
import type { UnwindRun } from "./types";

type View = "drop" | "list" | "detail";

export function App() {
  const [view, setView] = useState<View>("drop");
  const [dbFilename, setDbFilename] = useState("");
  const [selectedRun, setSelectedRun] = useState<UnwindRun | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const fileRef = useRef<File | null>(null);

  const handleFileLoaded = useCallback(async (file: File) => {
    await initDB(file);
    fileRef.current = file;
    setDbFilename(file.name);
    setView("list");
    setReloadKey((k) => k + 1);
  }, []);

  const handleReload = useCallback(async () => {
    if (fileRef.current) {
      await initDB(fileRef.current);
      setReloadKey((k) => k + 1);
    }
  }, []);

  const handleChangeFile = useCallback(() => {
    closeDB();
    fileRef.current = null;
    setSelectedRun(null);
    setView("drop");
  }, []);

  const handleSelectRun = useCallback((run: UnwindRun) => {
    setSelectedRun(run);
    setView("detail");
  }, []);

  const handleBack = useCallback(() => {
    setSelectedRun(null);
    setView("list");
  }, []);

  const handleNavigateToRun = useCallback((runId: string) => {
    const run = getRun(runId);
    if (run) {
      setSelectedRun(run);
      setView("detail");
    }
  }, []);

  // Dev helper: auto-load DB from ?load=/path query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loadUrl = params.get("load");
    if (loadUrl && view === "drop") {
      fetch(loadUrl)
        .then((r) => r.arrayBuffer())
        .then(async (buf) => {
          const file = new File([buf], loadUrl.split("/").pop() || "unwind.db");
          await initDB(file);
          fileRef.current = file;
          setDbFilename(file.name);
          setView("list");
          setReloadKey((k) => k + 1);
        })
        .catch(console.error);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (view === "drop") {
    return <DropZone onFileLoaded={handleFileLoaded} />;
  }

  if (view === "detail" && selectedRun) {
    return (
      <RunDetail
        run={selectedRun}
        onBack={handleBack}
        onNavigateToRun={handleNavigateToRun}
      />
    );
  }

  return (
    <RunList
      key={reloadKey}
      dbFilename={dbFilename}
      onReload={handleReload}
      onChangeFile={handleChangeFile}
      onSelectRun={handleSelectRun}
    />
  );
}
