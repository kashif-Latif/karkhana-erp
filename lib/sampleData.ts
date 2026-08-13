// Placeholder figures so the dashboard is showable before the DB is connected.
// Every number here is replaced by live Supabase queries once keys are set.

export const kpis = [
  { key: "value", label: "Total Raw-Material Value", value: "Rs 4,182,500", delta: "+6.2%", up: true, accent: "salmon" },
  { key: "receipts", label: "Today's Receipts", value: "Rs 512,000", delta: "+18.3%", up: true, accent: "amber" },
  { key: "issues", label: "Today's Issues", value: "Rs 286,400", delta: "-4.1%", up: false, accent: "periwinkle" },
  { key: "approvals", label: "Pending Approvals", value: "7", delta: "3 new", up: true, accent: "pink" },
] as const;

export const materials = [
  { name: "Fabric", qty: "12,480 KG", pct: 78, accent: "amber" },
  { name: "Thread", qty: "3,150 KG", pct: 61, accent: "lavender" },
  { name: "Zip", qty: "42,000 pcs", pct: 88, accent: "periwinkle" },
  { name: "Sticker", qty: "540 KG", pct: 34, accent: "pink" },
  { name: "Packing Shopper", qty: "910 KG", pct: 52, accent: "salmon" },
] as const;

export const approvals = [
  { no: "GRN-2026-000145", who: "ABC Textiles · Lycra Blue 500 KG", tag: "Goods Receipt", accent: "amber", urgent: true },
  { no: "ISS-2026-000098", who: "Cutting · Jersey Black 120 KG", tag: "Issue", accent: "periwinkle", urgent: false },
  { no: "ADJ-2026-000012", who: "Rate change · Lycra 650 → 675", tag: "Rate", accent: "pink", urgent: true },
  { no: "RET-2026-000031", who: "Cutting return · 4 KG", tag: "Return", accent: "lavender", urgent: false },
] as const;

// monthly material-consumption intensity 0..4 (drives the dot-matrix)
export const consumption = [
  3, 4, 2, 4, 3, 4, 4, 3, 2, 4, 3, 4,
];
export const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
