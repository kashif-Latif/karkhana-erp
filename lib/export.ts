/* ONE EXPORTER FOR EVERY TAB — csv, excel, pdf.
 *
 * No libraries, deliberately. CSV is plain text. "Excel" is an HTML table
 * served with Excel's mime type — Excel has opened these for twenty years
 * and it costs zero dependencies. PDF is the browser's own print-to-PDF on
 * a clean printable window, which is what a PDF library would rebuild
 * badly. All three take the SAME rows the person is looking at, so what
 * exports is exactly what was on screen — never a second query that could
 * disagree with it.
 */
export type ExportTable = { title: string; headers: string[]; rows: (string | number | null | undefined)[][] };

const cell = (v: unknown) => (v == null ? "" : String(v));

export function exportCSV({ title, headers, rows }: ExportTable) {
  const esc = (v: unknown) => `"${cell(v).replaceAll('"', '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  save(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), `${slug(title)}.csv`);
}

export function exportExcel({ title, headers, rows }: ExportTable) {
  const html =
    `<html><head><meta charset="utf-8"></head><body><table border="1">` +
    `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>` +
    rows.map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(cell(v))}</td>`).join("")}</tr>`).join("") +
    `</table></body></html>`;
  save(new Blob([html], { type: "application/vnd.ms-excel" }), `${slug(title)}.xls`);
}

export function exportPDF({ title, headers, rows }: ExportTable) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  w.document.write(
    `<html><head><title>${escapeHtml(title)}</title><style>
      body{font-family:system-ui,sans-serif;padding:24px;color:#1c1917}
      h1{font-size:18px;margin:0 0 4px} p{font-size:11px;color:#78716c;margin:0 0 16px}
      table{border-collapse:collapse;width:100%;font-size:12px}
      th,td{border:1px solid #d6d3d1;padding:6px 8px;text-align:left}
      th{background:#f5f5f4;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
      @media print{@page{margin:14mm}}
    </style></head><body><h1>${escapeHtml(title)}</h1><p>${new Date().toLocaleString()}</p><table>` +
    `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>` +
    rows.map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(cell(v))}</td>`).join("")}</tr>`).join("") +
    `</table><script>window.onload=()=>{window.print()}</script></body></html>`
  );
  w.document.close();
}

/* PRINT — laid out for paper, not for a PDF viewer.
 *
 * Differs from exportPDF in the ways paper differs from a screen: landscape
 * so wide tables are not cut off, a real <thead> so column names repeat on
 * every page, zebra rows dropped (they cost ink and read worse in mono),
 * and a row count in the footer so nobody wonders if a page went missing.
 */
export function printTable({ title, headers, rows }: ExportTable) {
  const w = window.open("", "_blank", "width=1000,height=760");
  if (!w) return;   /* pop-up blocked — nothing else to do about it here */
  w.document.write(
    `<html><head><title>${escapeHtml(title)}</title><style>
      @page{size:A4 landscape;margin:12mm}
      body{font-family:system-ui,sans-serif;color:#1c1917;margin:0}
      h1{font-size:16px;margin:0 0 2px}
      .meta{font-size:10.5px;color:#78716c;margin:0 0 12px}
      table{border-collapse:collapse;width:100%;font-size:11px}
      th,td{border:1px solid #d6d3d1;padding:5px 7px;text-align:left;vertical-align:top}
      th{background:#f5f5f4;font-size:9.5px;text-transform:uppercase;letter-spacing:.04em}
      thead{display:table-header-group}
      tr{break-inside:avoid}
      tfoot td{border:0;padding-top:10px;font-size:10px;color:#78716c}
    </style></head><body>
      <h1>${escapeHtml(title)}</h1>
      <p class="meta">${new Date().toLocaleString()} &middot; ${rows.length} row(s)</p>
      <table>
        <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(cell(v))}</td>`).join("")}</tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="${headers.length}">${escapeHtml(title)} &middot; printed ${new Date().toLocaleDateString()}</td></tr></tfoot>
      </table>
      <script>window.onload=()=>{window.print()}</script>
    </body></html>`
  );
  w.document.close();
}

function escapeHtml(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + new Date().toISOString().slice(0, 10);
}
function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
