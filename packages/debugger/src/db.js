const SQL_JS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/sql-wasm.js";
const SQL_JS_WASM_CDN = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/sql-wasm.wasm";
let sqlJsPromise = null;
function loadSqlJs() {
    if (sqlJsPromise)
        return sqlJsPromise;
    sqlJsPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = SQL_JS_CDN;
        script.onload = () => {
            const initSqlJs = window["initSqlJs"];
            if (!initSqlJs) {
                reject(new Error("sql.js did not load correctly"));
                return;
            }
            initSqlJs({ locateFile: () => SQL_JS_WASM_CDN })
                .then(resolve)
                .catch(reject);
        };
        script.onerror = () => reject(new Error("Failed to load sql.js from CDN"));
        document.head.appendChild(script);
    });
    return sqlJsPromise;
}
let db = null;
export async function initDB(file) {
    const SQL = await loadSqlJs();
    const buffer = file instanceof File
        ? new Uint8Array(await file.arrayBuffer())
        : new Uint8Array(file);
    if (db) {
        db.close();
    }
    db = new SQL.Database(buffer);
}
export function closeDB() {
    if (db) {
        db.close();
        db = null;
    }
}
export function isOpen() {
    return db !== null;
}
function getDB() {
    if (!db)
        throw new Error("Database not loaded");
    return db;
}
export function getRuns(filter) {
    const d = getDB();
    let query = "SELECT * FROM runs";
    const params = [];
    if (filter?.status) {
        query += " WHERE status = ?";
        params.push(filter.status);
    }
    query += " ORDER BY created_at DESC";
    const stmt = d.prepare(query);
    if (params.length)
        stmt.bind(params);
    const runs = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        runs.push({
            id: row.id,
            agentId: row.agent_id,
            parentRunId: row.parent_run_id || undefined,
            forkFromStep: row.fork_from_step != null ? Number(row.fork_from_step) : undefined,
            status: row.status,
            events: [],
            createdAt: row.created_at,
            completedAt: row.completed_at || undefined,
        });
    }
    stmt.free();
    for (const run of runs) {
        run.events = getEvents(run.id);
    }
    return runs;
}
export function getRun(id) {
    const d = getDB();
    const stmt = d.prepare("SELECT * FROM runs WHERE id = ?");
    stmt.bind([id]);
    if (!stmt.step()) {
        stmt.free();
        return null;
    }
    const row = stmt.getAsObject();
    stmt.free();
    return {
        id: row.id,
        agentId: row.agent_id,
        parentRunId: row.parent_run_id || undefined,
        forkFromStep: row.fork_from_step != null ? Number(row.fork_from_step) : undefined,
        status: row.status,
        events: getEvents(id),
        createdAt: row.created_at,
        completedAt: row.completed_at || undefined,
    };
}
export function getEvents(runId) {
    const d = getDB();
    const stmt = d.prepare("SELECT data FROM events WHERE run_id = ? ORDER BY step_index ASC");
    stmt.bind([runId]);
    const events = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        events.push(JSON.parse(row.data));
    }
    stmt.free();
    return events;
}
export function getRunCount(filter) {
    const d = getDB();
    let query = "SELECT COUNT(*) as cnt FROM runs";
    const params = [];
    if (filter?.status) {
        query += " WHERE status = ?";
        params.push(filter.status);
    }
    const stmt = d.prepare(query);
    if (params.length)
        stmt.bind(params);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return row.cnt;
}
//# sourceMappingURL=db.js.map