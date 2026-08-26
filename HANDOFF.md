# KARKHANA HUB — HANDOFF (26 Aug 2026)

Paste this into a new chat. It is written so the next session does not re-open
anything already settled.

---

## WHERE THINGS STAND

Supabase project `ozkhkhlwjblzgwmjbdde` (Karkhana). Free tier: DB ~69 MB / 500 MB,
egress was 164 MB in one day before the 25 Aug fix — **still unverified, check it**.

### Working and verified

| | State |
|---|---|
| Shopify webhooks, all 3 stores | live, median **5s**, 42/42 delivered |
| Shopify auth | LM = admin token (has `read_all_orders`); TS + TRZ = client credentials |
| Orders | **16,022**, zero duplication, LM back to Aug 2024 |
| PostEx status | every 10 min, per-parcel (bulk endpoint returns 405) |
| PostEx new parcels | every 30 min + nightly 45-day sweep |
| OwnEx status | every 10 min — **no webhook exists, this is the ceiling** |
| Orders vs Shopify | reconciled day-by-day, 7 of 7 exact |
| Dashboard / Orders / Logistics / Returns / **Finance** | counted database-side |

### Migrations applied: 0059 – 0075.  Ready to apply: **0076, 0077**

0059 return-leg direction · 0060 portal labels · 0061 sync health · 0062 order state
· 0063 realtime + event dedup · 0064 prune events · 0065 returns sections
· 0066 orders summary + real schedules · 0067 self-healing windows
· 0068 cancellation staff note · 0070 UNFULFILLED fix · 0071 timezone
· 0072 repair all status · 0073 cancelled returns leave pending
· 0074 dashboard summary · 0075 prune shopify events
· **0076 courier reason text** · **0077 finance summary**

`HEALTH_CHECK.sql` (rev 26 Aug) and `VERIFY_STORES.sql` exist — run them before
trusting anything.

---

## DONE 26 AUG

### Return reason — the courier's real wording (0076)

The reason was arriving and being thrown away. OwnEx history, verbatim:

```json
{"status":"Verifying Reason","code":"debrief","description":"UNTRACEABLE ADDRESS"}
```

`ownex-sync` read that array for direction detection, kept "Verifying Reason" in
`raw_status`, and discarded the description. PostEx welds its reason onto the
status instead: `Reason - REFUSED TO RECEIVE`.

Now: `online_logistics.courier_reason_text` holds the reason alone, unprefixed.
Returns page priority is **agent note → courier reason → Shopify → tags → status**.

Three things about it that will save the next session an argument:

* **PostEx backfills instantly, OwnEx cannot.** The PostEx wording is already in
  `rts_reason` and `raw_status` behind the `Reason - ` marker, so 0076 extracts
  it with no re-sync. OwnEx descriptions were never written to any table — not
  even `online_courier_events`, which stores `raw_status` alone. Those rows fill
  in on the next sync pass and not before.
* **The column is never nulled.** A parcel that moves again after a debrief must
  not lose the finding. Both syncs only write when they have one.
* **Both syncs compare the prior REASON, not just the prior status.** Without
  that, the "nothing changed, skip the write" shortcut would keep every existing
  parcel blank forever, because its status never moves again.

Only reason-bearing OwnEx codes are read (`debrief`, `reason`, `reattempt`, the
return stages). Movement codes carry station names in `description`, and
"Lahore Hub" is not a reason a parcel came back.

### Finance — TWO bugs, not one (0077)

The known one: the 1,000-row cap. The unknown one was worse:

```js
if (from) q = q.gte("payment_date", from);
```

An unpaid parcel has `payment_date` NULL, and NULL fails every comparison. The
default range is "30 days". **Every pending parcel was deleted from the query
before the cap was even reached** — the "Pending payment" card was showing the
unpaid subset of paid rows.

Fixed by dating each row by the event that happened to it:
`v_finance_payments.finance_date` = payment_date when paid, delivery_date when
not. Cards read `hub_finance_summary()`; a per-courier strip reads
`hub_finance_by_courier()`, because OwnEx has no payment API and a blended
number hides which half is automatable.

### Revenue: GROSS COD. Decided, and reversible.

Three figures, not one:

| | |
|---|---|
| Gross COD | what the customer handed over — **this is revenue** |
| Courier charges | what the courier kept — this is a cost |
| Net expected | what lands in the bank — this reconciles the CPR |

Netting silently would bury Rs 531,727 of expense inside a revenue number and
make delivery margin invisible; gross alone leaves the CPR impossible to tie out.
The RPC returns all three, so changing this is a display edit, not a rebuild.

---

## OPEN — IN PRIORITY ORDER

### 1. CPR / settlement import — WAITING ON FILES

`online_cpr` and `online_returns` are both **empty** (0 rows). No legacy conflict.

Waiting on: one PostEx CPR export, one OwnEx payment/invoice export.
**Do not write a parser before seeing real files** — guessing a format cost three
rounds on the OwnEx load sheet.

Agreed design:
- Upload PDF/XLS through the same Smart import door
- **Guard first**: parcel count and total must match the sheet or nothing writes
- One `online_cpr` batch row; per-parcel `payment_status`, `payment_date`,
  `cpr_number`, `cpr_net_amount`, `courier_fee`
- **A CPR corrects status**: a courier does not pay for parcels that came back, so
  anything in the file becomes Delivered whatever we thought
- Re-uploadable, keyed on tracking number
- Report what moved: "142 paid · 18 corrected from In Transit · 3 from Returned"

If OwnEx exports nothing at all, Rs 973,296 can only ever be entered by hand —
say so plainly rather than building a parser for a file that does not exist.

### 2. Verify 0076 actually filled the gap

Run `hub_returns_reason_coverage('ALL', null)` before redeploying the syncs, then
again an hour after. "courier reason" should climb, "no reason at all" should
fall. If OwnEx does not move, `discover_codes` now reports every description it
sees grouped by code — read that before changing any mapping.

### 3. Three pre-existing type errors in postex-sync

Not introduced by today's work — identical on the untouched original. Only one is
real: `res.getAttempt` at the `postex_pull` error return is a union-narrowing
fault. Harmless at runtime and it does not block deploy, because the Supabase
CLI bundles with esbuild and esbuild does not type-check. Worth fixing when that
file is next opened.

### 4. Zeeshan's actions, not code

- **PostEx webhook URL** still points at the OLD littleminors project.
  Repoint to `.../functions/v1/postex-webhook`, Verify JWT OFF → 10 min becomes seconds.
- **`shopify-webhook` still has Verify JWT enabled** — blocks second-level updates.
- **Rotate credentials.** Several tokens went through chat and WhatsApp on 25 Aug.
- **TS + TRZ `read_all_orders`** — though `fetched: 0` for Jan–Jun suggests
  TopShop and Trenzee genuinely opened in June 2026.

---

## DEPLOY ORDER (0076/0077)

Order matters. The syncs write a column that does not exist until 0076 runs.

1. Run **0076**, then **0077**, in the Supabase SQL editor.
2. Redeploy `ownex-sync` and `postex-sync`.
3. Deploy the frontend (Finance + Returns pages).
4. Run `HEALTH_CHECK.sql`.

Deploying the syncs first is not fatal — the write fails, the row is skipped, the
run reports an error — but it wastes a cycle and the errors look alarming.

---

## MONEY (as of 25 Aug — re-read after 0077, the pending figure will move)

```
COD delivered but unpaid    Rs 1,433,781  ·  587 parcels   (was understated twice over)
  PostEx                    Rs   313,472  ·  122
  OwnEx                     Rs   973,296  ·  412           ← no payment API at all
Pending returns             Rs 2,381,855  ·  oldest 228 days
Delivered, no order behind  Rs 2,550,259  ·  1,381 parcels
```

---

## HOW IT WORKS NOW

```
Shopify  --webhook-->  shopify-webhook  -->  online_orders      ~5 s
Shopify  --cron----->  shopify-sync     -->  online_orders      hourly + nightly 30d
PostEx   --cron----->  postex-sync      -->  online_logistics   10 min (status) / 30 min (new)
OwnEx    --cron----->  ownex-sync       -->  online_logistics   10 min
Browser  --realtime->  repaints                                 ~1 s after DB change
```

Push for speed, poll for completeness.

---

## RULES LEARNED THE HARD WAY

**Validate frontend with `tsc --noEmit` AND `next build`.** esbuild strips types
without checking them — it reported four files clean that then broke Vercel three
times. Note `tsconfig.json` excludes `supabase/`, so the edge functions are NOT
covered by `tsc`; check them separately or they ship unchecked.

**PostgREST caps responses at 1,000 rows** whatever `.limit()` says. Anything
counted in the browser is wrong. Count in the database. Four pages hit this.

**NULL fails every comparison, so a date filter silently deletes rows.** Filtering
on a column that is null for exactly the rows you care about removes them
entirely — and it looks like a small number, not an error. Date rows by an event
that always happened.

**PostgREST takes its column list from the FIRST object in an upsert array.** A
ragged payload either errors or nulls the column on every row that omitted it.
Uniform rows for the upsert; optional columns go in a separate pass.

**A green tick from the thing being tested is not evidence.** cron logged
`succeeded` over 401s for months. `postex_track` returned `ok:true` with
`updated: 0` and its failures buried in an `errors` array. Read outcomes, not
status codes.

**A test that passes on noise is worse than no test.** The old health check
counted a return as "explained" if it had a tag. Tags are process, not cause.

**When the same bug shape exists, check every instance.** The tracker exclusion
bug was fixed in OwnEx at 09:00 and sat in PostEx until 18:00.

**Never compare against a dashboard card.** Shopify's "7 days" is eight days.
Use explicit date filters on both sides.

**Substring tests on status:** `/FULFILLED/.test("UNFULFILLED")` is `true`.
It inverted the entire Orders page.

**`CREATE OR REPLACE VIEW` cannot rename or reorder columns** — drop first (0058).

**`VACUUM` cannot run in the Supabase SQL editor** — it wraps everything in a
transaction. Run it alone in an empty tab.

**Zeeshan's own queries found most of these bugs.** Ask for real output rather
than reasoning from the outside.
