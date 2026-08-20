// ============================================================================
// Authentification (code à 6 chiffres envoyé par email) + création/rejoint d'un couple.
// On utilise un code à taper plutôt qu'un simple lien cliquable : sur un téléphone,
// cliquer le lien reçu dans l'appli Mail l'ouvre dans Safari/Chrome, un contexte de
// stockage SÉPARÉ de l'appli installée sur l'écran d'accueil (PWA) — la session s'établit
// dans le mauvais endroit et l'appli installée redemande de se connecter. Le code tapé
// directement dans l'appli n'a pas ce problème : tout se passe dans le même contexte.
// ============================================================================
import { supabase } from './supabase-client.js';

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(cb) {
  supabase.auth.onAuthStateChange((_event, session) => cb(session));
}

export async function signInWithEmail(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

// Vérifie le code à 6 chiffres reçu par email et établit la session — se fait
// entièrement dans l'onglet/l'appli courant·e, sans jamais changer de contexte.
export async function verifyOtp(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Retourne { coupleId, role } si l'utilisateur connecté appartient déjà à un couple, sinon null.
export async function getMyCouple() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('couple_members').select('couple_id, role').eq('user_id', user.id).limit(1).maybeSingle();
  if (error) throw error;
  return data ? { coupleId: data.couple_id, role: data.role } : null;
}

// Crée un nouveau couple (l'utilisateur connecté devient le membre "a") et retourne son id.
export async function createCouple(aName, bName) {
  const { data, error } = await supabase.rpc('create_couple', { a_name: aName, b_name: bName });
  if (error) throw error;
  return data; // uuid du nouveau couple
}

// Rejoint un couple existant via son code d'invitation (l'utilisateur devient le membre "b").
export async function joinCouple(code) {
  const { data, error } = await supabase.rpc('join_couple', { code });
  if (error) throw error;
  return data; // uuid du couple rejoint
}

// Récupère le code d'invitation du couple courant, à partager avec le/la partenaire.
export async function getInviteCode(coupleId) {
  const { data, error } = await supabase.from('couples').select('invite_code').eq('id', coupleId).single();
  if (error) throw error;
  return data.invite_code;
}
