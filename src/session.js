// One session per connection. Analyses, console queries and clears run serially.
import { annotate, clearAnnotation } from "./annotate.js";
import { peek, clearPeek } from "./peek.js";
import { createPeakStore } from "./peaks.js";

export function createSession(conn) {
  const cache = {}, peaks = createPeakStore(conn);
  let pending = Promise.resolve(), invalidated = false, live = {};
  const serial = (operation) => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
  async function clear() {
    live = {};
    await clearAnnotation(conn, cache);
    await peaks.clear();
    await clearPeek(conn);
    invalidated = false;
  }
  return {
    run(view, request, observer = {}) {
      return serial(async () => {
        if (invalidated) await clear();
        if (live.view === "peek") await clearPeek(conn);
        live = {};
        const files = await peaks.sync(request.peaks);
        const result = view === "peek"
          ? await peek(conn, request, { files, keepTables: true })
          : await annotate(conn, request, { ...observer, cache, files });
        live = { ...request, view, files, settings: result.meta?.settings,
          format: result.meta?.format, partitionIndex: cache.partitionIndex };
        return result;
      });
    },
    query(sql) {
      return serial(() => {
        // SELECT can mutate DuckHTS indexes; a statement-prefix check is insufficient.
        // Leave tables available for exploration, then rebuild on the next analysis.
        invalidated = true;
        return conn.query(sql);
      });
    },
    context: () => live,
    clear: () => serial(clear),
  };
}
