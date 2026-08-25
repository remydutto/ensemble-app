// ============================================================================
// Authentification (lien magique par email) + création/rejoint d'un couple.
//
// À utiliser dans Safari/Chrome directement (pas via une icône ajoutée à l'écran
// d'accueil) : sur iPhone, une icône installée a un stockage complètement séparé
// de Safari, donc cliquer le lien reçu dans Mail (qui s'ouvre dans Safari) ne peut
// jamais établir de session dans l'icône. `verifyOtp` ci-dessous reste disponible
// si on veut un jour passer à un code à 6 chiffres tapé dans l'appli (ce qui
// contournerait ce problème) — non branché à l'UI pour l'instant, car ça demande
// de configurer un SMTP personnalisé côté Supabase pour personnaliser l'email.
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
    // On utilise le dossier de la page actuelle (et pas juste window.location.origin)
    // car sur GitHub Pages l'appli n'est pas à la racine du domaine mais dans un
    // sous-dossier (ex. https://xxx.github.io/ensemble-app/) : origin seul renverrait
    // le lien vers la racine du domaine, en dehors de l'appli.
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
