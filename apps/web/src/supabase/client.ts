import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfig = {
  hasUrl: supabaseUrl !== undefined && supabaseUrl.length > 0,
  hasAnonKey: supabaseAnonKey !== undefined && supabaseAnonKey.length > 0
};

export const supabase =
  supabaseUrl === undefined || supabaseAnonKey === undefined || supabaseUrl.length === 0 || supabaseAnonKey.length === 0
    ? null
    : createClient<Database>(supabaseUrl, supabaseAnonKey);
