import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True once real Supabase keys are provided. Until then the app runs in preview. */
export const isSupabaseConfigured = Boolean(url && key);

/** Null in preview mode so the UI can render without a backend. */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, key as string)
  : null;
