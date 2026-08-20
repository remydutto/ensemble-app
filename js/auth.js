// ============================================================================
// Authentification (lien magique par email) + création/rejoint d'un couple.
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
