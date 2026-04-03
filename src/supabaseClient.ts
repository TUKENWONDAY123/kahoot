import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL || 'https://afwtmvturyetaqruihsr.supabase.co';
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmd3RtdnR1cnlldGFxcnVpaHNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMzM3MjUsImV4cCI6MjA5MDcwOTcyNX0.MmBoHJSe5uH_sOhe1WK5egr1znH-4hlm3eBzwgRwL10';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
