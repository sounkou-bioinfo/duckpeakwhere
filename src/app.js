// Page wiring: pick bundled files, run the SQL annotation, draw the result.
import * as Plot from "../vendor/plot.js";
import { openDatabase } from "./db.js";
import { annotate, CATEGORIES, CATEGORY_LABELS } from "./annotate.js";

/** Bundled datasets, served from this origin. */
export const DATASETS = {
  thymus: {
    name: "Mouse thymus, chr19 (GENCODE M25, ENCODE)",
    annotations: { "GENCODE vM25 basic, chr19 (GFF3)": "examples/gencode.vM25.basic.chr19.gff3.gz" },
    peaks: {
      H3K4me3: "examples/thymus_H3K4me3_ENCFF674JZY.chr19.narrowPeak.gz",
      H3K27me3: "examples/thymus_H3K27me3_ENCFF478UYW.chr19.narrowPeak.gz",
      H3K36me3: "examples/thymus_H3K36me3_ENCFF853BYO.chr19.narrowPeak.gz",
      CTCF: "examples/thymus_CTCF_ENCFF714WDP.chr19.narrowPeak.gz",
      DNase: "examples/thymus_DNase_ENCFF979ULB.chr19.narrowPeak.gz",
    },
  },
  fixture: {
    name: "Hand-built test fixture",
    annotations: {
      "fixture.gff3": "test/fixtures/fixture.gff3",
      "fixture.gtf": "test/fixtures/fixture.gtf",
    },
    peaks: {
      peaks: "test/fixtures/peaks.bed",
      "peaks-nochr": "test/fixtures/peaks-nochr.bed",
    },
  },
};

const COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#d97706", "#65a30d", "#9ca3af"];
const $ = (id) => document.getElementById(id);

function option(value, text) {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = text;
  return el;
}

function showDataset(key) {
  const dataset = DATASETS[key];
  $("annotation").replaceChildren(
    ...Object.entries(dataset.annotations).map(([name, url]) => option(url, name)),
  );
  $("peaks").replaceChildren(
    ...Object.entries(dataset.peaks).map(([label, url]) => {
      const box = document.createElement("label");
      box.className = "inline";
      box.innerHTML = `<input type="checkbox" checked> `;
      box.firstChild.value = url;
      box.firstChild.dataset.label = label;
      box.append(label);
      return box;
    }),
  );
}

function request() {
  const peaks = [...$("peaks").querySelectorAll("input:checked")].map((box) => ({
    url: new URL(box.value, location.href).href,
    label: box.dataset.label,
  }));
  if (peaks.length === 0) throw new Error("Choose at least one peak file.");
  return {
    annotation: new URL($("annotation").value, location.href).href,
    peaks,
    settings: {
      promoterUpstream: Number($("up").value),
      promoterDownstream: Number($("down").value),
      mode: $("mode").value,
      proteinCodingOnly: $("coding").checked,
    },
  };
}

function draw({ results, background, meta, warnings }) {
  const bars = [...results.filter((r) => r.drawn), ...(background ? [background] : [])];
  const total = (r) => CATEGORIES.reduce((n, c) => n + r.counts[c], 0);
  const data = bars.flatMap((r) =>
    CATEGORIES.map((c) => ({ bar: r.label, category: CATEGORY_LABELS[c], share: r.counts[c] / (total(r) || 1) })),
  );
  $("chart").replaceChildren(
    Plot.plot({
      marginLeft: 90,
      x: { label: "Share", percent: true, domain: [0, 100] },
      y: { label: null, domain: bars.map((r) => r.label) },
      color: { domain: CATEGORIES.map((c) => CATEGORY_LABELS[c]), range: COLORS, legend: true },
      marks: [Plot.barX(data, { x: "share", y: "bar", fill: "category", order: CATEGORIES.map((c) => CATEGORY_LABELS[c]), tip: true })],
    }),
  );

  const unit = meta.settings.mode === "bp" ? "base pairs" : "peak centres";
  const { promoterUpstream: up, promoterDownstream: down } = meta.settings;
  $("summary").textContent =
    `Counting ${unit}; promoter ${up} bp upstream to ${down} bp downstream of the TSS; ` +
    `priority ${CATEGORIES.map((c) => CATEGORY_LABELS[c]).join(" > ")}; ` +
    `${meta.transcripts.toLocaleString()} transcripts (${meta.format.toUpperCase()}` +
    `${meta.assembly ? `, ${meta.assembly}` : ""}).`;
  const hidden = results
    .filter((r) => !r.drawn)
    .map((r) => `${r.label}: not drawn, because more than 5% of its peaks are on chromosomes the annotation lacks.`);
  $("warnings").replaceChildren(
    ...[...hidden, ...warnings].map((w) => {
      const li = document.createElement("li");
      li.textContent = w;
      return li;
    }),
  );

  const head = `<tr><th>File</th>${CATEGORIES.map((c) => `<th>${CATEGORY_LABELS[c]}</th>`).join("")}<th>Unmatched</th></tr>`;
  const row = (r) =>
    `<tr data-label="${r.label}"><th>${r.label}</th>${CATEGORIES.map((c) => `<td data-category="${c}">${r.counts[c].toLocaleString("en")}</td>`).join("")}` +
    `<td data-category="unmatched">${r.background ? "" : r.unmatched.toLocaleString("en")}</td></tr>`;
  $("table").innerHTML = head + [...results, ...(background ? [background] : [])].map(row).join("");
  $("output").hidden = false;
}

async function main() {
  $("dataset").replaceChildren(...Object.entries(DATASETS).map(([key, d]) => option(key, d.name)));
  $("dataset").addEventListener("change", () => showDataset($("dataset").value));
  showDataset($("dataset").value);

  let conn;
  try {
    const opened = await openDatabase();
    conn = opened.conn;
    $("status").textContent = `DuckDB ${opened.version} (${opened.platform}) with DuckHTS loaded.`;
    $("run").disabled = false;
    $("run").textContent = "Annotate peaks";
  } catch (error) {
    $("status").textContent = `Could not start DuckDB with DuckHTS: ${error.message}`;
    $("run").textContent = "Unavailable";
    return;
  }

  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("run").disabled = true;
    $("status").textContent = "Annotating…";
    const started = performance.now();
    try {
      draw(await annotate(conn, request()));
      $("status").textContent = `Done in ${((performance.now() - started) / 1000).toFixed(1)} s.`;
      document.body.dataset.state = "done";
    } catch (error) {
      $("status").textContent = error.message;
      document.body.dataset.state = "error";
    } finally {
      $("run").disabled = false;
    }
  });
}

main();
