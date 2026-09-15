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
  /* A real PDF, written by hand and downloaded — not the print dialog wearing
     a PDF label. Landscape A4, Helvetica, one table drawn as positioned text.
     No library: a charting or PDF dependency for one table is a lot of weight
     to carry, and this only has to render text in columns.
  */
  const W = 842, H = 595, M = 28;            // A4 landscape, points
  const cols = headers.length;
  const colW = (W - M * 2) / cols;
  const esc = (t: string) => String(t ?? "")
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "");          // PDF base fonts are Latin-1 only
  const clip = (t: string, w: number, size: number) => {
    const max = Math.floor(w / (size * 0.5));
    const v = String(t ?? "");
    return v.length > max ? v.slice(0, Math.max(1, max - 1)) + "-" : v;
  };

  const perPage = Math.floor((H - M * 2 - 34) / 13);
  const pages: (string | number | null | undefined)[][][] = [];
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage));
  if (pages.length === 0) pages.push([]);

  const streams = pages.map((pageRows, pi) => {
    let y = H - M;
    let t = `BT /F2 13 Tf ${M} ${y} Td (${esc(title)}) Tj ET\n`;
    y -= 14;
    t += `BT /F1 8 Tf ${M} ${y} Td (${esc(new Date().toLocaleString())} - page ${pi + 1} of ${pages.length} - ${rows.length} row(s)) Tj ET\n`;
    y -= 16;
    headers.forEach((h, ci) => {
      t += `BT /F2 8 Tf ${M + ci * colW} ${y} Td (${esc(clip(h.toUpperCase(), colW, 8))}) Tj ET\n`;
    });
    y -= 4;
    t += `${M} ${y} m ${W - M} ${y} l 0.6 w S\n`;
    y -= 11;
    pageRows.forEach((r) => {
      r.forEach((v, ci) => {
        t += `BT /F1 8 Tf ${M + ci * colW} ${y} Td (${esc(clip(cell(v), colW, 8))}) Tj ET\n`;
      });
      y -= 13;
    });
    return t;
  });

  const objs: string[] = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, i) => `${3 + i} 0 R`).join(" ");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  const first = 3 + pages.length;
  pages.forEach((_, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Resources << /Font << /F1 ${first + pages.length} 0 R /F2 ${first + pages.length + 1} 0 R >> >> ` +
      `/Contents ${first + i} 0 R >>`);
  });
  streams.forEach((st) => objs.push(`<< /Length ${st.length} >>\nstream\n${st}endstream`));
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += String(off).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  save(new Blob([pdf], { type: "application/pdf" }), slug(title) + ".pdf");
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
      @page{size:A4 landscape;margin:8mm}
      body{font-family:system-ui,sans-serif;color:#1c1917;margin:0}
      h1{font-size:16px;margin:0 0 2px}
      .meta{font-size:10.5px;color:#78716c;margin:0 0 12px}
      table{border-collapse:collapse;width:100%;font-size:8.5px}
      th,td{border:1px solid #d6d3d1;padding:2px 4px;text-align:left;vertical-align:top;line-height:1.25}
      th{background:#f5f5f4;font-size:7.5px;text-transform:uppercase;letter-spacing:.04em}
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
