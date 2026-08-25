// ============================================================================
// Authentification : email + mot de passe, ou connexion avec Google.
//
// On n'utilise plus le lien magique par email en usage courant : le mailer
// gratuit de Supabase est plafonné à quelques emails par heure pour tout le
// projet, ce qui bloquait les connexions dès qu'on le testait un peu. Le mot
// de passe et Google ne dépendent d'aucun email envoyé par Supabase, donc
// aucune limite. `signInWithEmail`/`verifyOtp` restent dispo plus bas si on
// veut un jour un mode "lien reçu par email" en plus (ex. mot de passe oublié).
// ============================================================================
import { supabase } from './supabase-client.js';
import { DEMO_MODE } from './store.js';

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(cb) {
  supabase.auth.onAuthStateChange((_event, session) => cb(session));
}

export async function signInWithPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUpWithPassword(email, password) {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    // Même remarque que pour le lien magique : on redirige vers le dossier de
    // la page actuelle (et pas window.location.origin) car sur GitHub Pages
    // l'appli est dans un sous-dossier (ex. https://xxx.github.io/ensemble-app/).
    options: { redirectTo: new URL('.', window.location.href).href },
  });
  if (error) throw error;
}

// Lien magique par email — plus utilisé dans l'UI actuelle (voir note en haut
// de fichier), gardé au cas où on veuille le réintroduire pour un usage ponctuel.
export async function signInWithEmail(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: new URL('.', window.location.href).href },
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

// Change le mot de passe du compte connecté — nécessite une session active
// (donc d'être déjà connecté), pas d'email envoyé, aucune limite.
export async function updatePassword(newPassword) {
  if (DEMO_MODE) throw new Error("Mode démo : impossible de changer un mot de passe ici. Crée ton compte pour de vrai !");
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
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
