"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

/* Live updates without pressing Refresh.
 *
 * A webhook can write a status change to the database in about a second, but
 * the browser has no idea until something tells it. This subscribes to Postgres
 * changes and calls back so the page can reload itself.
 *
 * WHY THE DEBOUNCE MATTERS
 *   One Shopify order fires several webhooks in quick succession (create, then
 *   paid, then fulfilled), and a courier sync can update hundreds of rows in one
 *   run. Reacting to each one would mean hundreds of full page queries in a few
 *   seconds — slow for the user and, on a free project, a real waste of the
 *   quota. Changes inside the window are coalesced into a single reload.
 *
 * Realtime respects RLS, so a subscriber only ever hears about rows it could
 * have selected itself. */
export function useLiveTables(
  tables: string[],
  onChange: () => void,
  { debounceMs = 1500, enabled = true }: { debounceMs?: number; enabled?: boolean } = {},
) {
  const [live, setLive] = useState(false);
  const [lastChange, setLastChange] = useState<Date | null>(null);

  // hold the callback in a ref so a re-render does not tear down the channel
  const cb = useRef(onChange);
  cb.current = onChange;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = tables.join(",");

  useEffect(() => {
    if (!supabase || !enabled || !tables.length) return;

    const channel = supabase.channel(`live:${key}`);

    for (const table of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          setLastChange(new Date());
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => cb.current(), debounceMs);
        },
      );
    }

    channel.subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase!.removeChannel(channel);
      setLive(false);
    };
    // `key` stands in for `tables` so a new array identity each render does not
    // reconnect the socket every time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, debounceMs, enabled]);

  return { live, lastChange };
}
