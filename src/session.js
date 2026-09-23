// One session per connection. Calls are serial: the app disables input while running.
import { annotate, clearAnnotation } from "./annotate.js";
import { peek } from "./peek.js";
import { createPeakStore } from "./peaks.js";

export function createSession(conn) {
  const cache = {}, peaks = createPeakStore(conn);
  return {
    async run(view, request, observer = {}) {
      const files = await peaks.sync(request.peaks);
      return view === "peek"
        ? peek(conn, request, { files })
        : annotate(conn, request, { ...observer, cache, files });
    },
    async clear() {
      await clearAnnotation(conn, cache);
      await peaks.clear();
    },
  };
}
