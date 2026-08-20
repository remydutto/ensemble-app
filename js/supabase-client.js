// Client Supabase, importé directement depuis un CDN (esm.sh) — pas de build/bundler nécessaire.
// Fonctionne dans n'importe quel navigateur moderne via <script type="module">.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
