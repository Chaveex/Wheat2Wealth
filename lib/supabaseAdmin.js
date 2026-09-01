import { createClient } from '@supabase/supabase-js';

// This client uses the SERVICE ROLE key, which bypasses Row Level Security.
// It must only ever be imported from server-side code (API routes), never
// from a 'use client' component or anything that ships to the browser.
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.warn(
    'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing. Set them in your environment (see README.md).'
  );
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});
