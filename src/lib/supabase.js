import { createClient } from '@supabase/supabase-js'

// 🔧 CONFIGURACIÓN — Cambia estos valores por los de tu proyecto Supabase
const SUPABASE_URL = 'https://lwigogymjoyyzwiyewgi.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3aWdvZ3ltam95eXp3aXlld2dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNjA1NTYsImV4cCI6MjA4ODczNjU1Nn0.wIey0LPv3pNpz-qlOcB-w15mA9OwWaB3FPDj1VyMqgg'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
