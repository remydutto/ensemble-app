// ============================================================================
// Couche de données : synchronise l'état local avec Supabase (fetch initial + realtime),
// et expose des méthodes CRUD utilisées par l'UI. Le reste de l'app (calc.js, ui.js)
// travaille sur `store.*`, qui a la même forme que le `state` du prototype à ceci près :
// paid_by / person / debtor / creditor valent "a" ou "b" (pas "remy"/"partner").
// ============================================================================
import { supabase } from './supabase-client.js';
import { monthKey, currentMonthKey, daysInRealMonth } from './calc.js';

// ----------------------------------------------------------------------------
// Mode démo (voir demo.html) : aucune donnée réelle, aucun appel à Supabase.
// Un visiteur peut explorer l'appli avec des données fictives sans compte ;
// toute tentative de modification affiche un message au lieu d'écrire en base.
// ----------------------------------------------------------------------------
export const DEMO_MODE = typeof window !== 'undefined' && window.__ENSEMBLE_DEMO__ === true;
const DEMO_MSG = "Mode démo : les modifications ne sont pas enregistrées. Crée ton compte pour utiliser Ensemble avec tes vraies données !";
function demoGuard() { if (DEMO_MODE) throw new Error(DEMO_MSG); }

export const store = {
  coupleId: null,
  myRole: null, // "a" | "b" — le rôle de l'utilisateur connecté dans CE couple
  memberAName: 'Personne A',
  memberBName: 'Personne B',
  splitMode: 'cumulative',
  categories: [],
  expenses: [],
  incomeEntries: [],
  settlements: [],
  recurring: [],
};

let onChangeCallback = () => {};
export function onStoreChange(cb) { onChangeCallback = cb; }

function notify() { onChangeCallback(); }

// ----------------------------------------------------------------------------
// Chargement initial + abonnement realtime
// ----------------------------------------------------------------------------
export async function loadCouple(coupleId, myRole) {
  store.myRole = myRole;

  if (DEMO_MODE) {
    seedDemoData();
    notify();
    return;
  }

  store.coupleId = coupleId;

  const { data: couple, error: coupleErr } = await supabase
    .from('couples').select('*').eq('id', coupleId).single();
  if (coupleErr) throw coupleErr;
  store.memberAName = couple.member_a_name;
  store.memberBName = couple.member_b_name;
  store.splitMode = couple.split_mode;

  await Promise.all([
    refetchCategories(),
    refetchExpenses(),
    refetchIncome(),
    refetchSettlements(),
    refetchRecurring(),
  ]);

  // Génère les occurrences de dépenses récurrentes manquantes jusqu'au mois réel courant.
  await generateRecurringOccurrences();

  subscribeRealtime(coupleId);
  notify();
}

function subscribeRealtime(coupleId) {
  const tables = [
    ['categories', refetchCategories],
    ['expenses', refetchExpenses],
    ['income_entries', refetchIncome],
    ['settlements', refetchSettlements],
    ['recurring_expenses', refetchRecurring],
  ];
  const channel = supabase.channel('couple-' + coupleId);
  tables.forEach(([table, refetch]) => {
    channel.on('postgres_changes',
      { event: '*', schema: 'public', table, filter: `couple_id=eq.${coupleId}` },
      async () => { await refetch(); notify(); }
    );
  });
  channel.on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'couples', filter: `id=eq.${coupleId}` },
    (payload) => {
      store.memberAName = payload.new.member_a_name;
      store.memberBName = payload.new.member_b_name;
      store.splitMode = payload.new.split_mode;
      notify();
    }
  );
  channel.subscribe();
}

// ----------------------------------------------------------------------------
// Données fictives du mode démo — un couple, des catégories, et 6 mois
// d'historique généré autour de la date du jour. Volontairement irrégulier
// (montants variables, dépenses ponctuelles, revenus inégaux entre les deux
// personnes) pour bien montrer l'intérêt de la répartition automatique et
// des graphiques, plutôt qu'un mois copié-collé six fois.
// ----------------------------------------------------------------------------
function pad2(n) { return String(n).padStart(2, '0'); }
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
function round2(n) { return Math.round(n * 100) / 100; }

function seedDemoData() {
  const today = new Date();

  const catDefs = [
    { label: 'Courses',           icon: '🛒', color: '--s1' },
    { label: 'Loyer',             icon: '🏠', color: '--s2' },
    { label: 'Transport',         icon: '🚗', color: '--s3' },
    { label: 'Loisirs',           icon: '🎬', color: '--s4' },
    { label: 'Restaurants',       icon: '🍽️', color: '--s5' },
    { label: 'Santé',             icon: '💊', color: '--s6' },
    { label: 'Abonnements',       icon: '📺', color: '--s7' },
    { label: 'Voyages & Cadeaux', icon: '🎁', color: '--s8' },
  ];
  store.categories = catDefs.map((c, i) => ({ id: `demo-cat-${i}`, couple_id: 'demo-couple', ...c }));
  const catId = label => store.categories.find(c => c.label === label).id;

  store.coupleId = 'demo-couple';
  store.memberAName = 'Alex';
  store.memberBName = 'Camille';
  // Revenus volontairement inégaux entre les deux (voir plus bas) : ça met en
  // valeur l'intérêt du mode "cumulative" (répartition au prorata des revenus)
  // plutôt qu'un simple 50/50.
  store.splitMode = 'cumulative';

  const expenses = [];
  const incomeEntries = [];
  const settlements = [];
  let eid = 0, iid = 0, sid = 0;

  // Ponctuels : un par mois maximum, pas tous les mois — donne des pics visibles
  // sur le graphique "Dépenses totales" plutôt qu'une courbe plate.
  const oneOffs = [
    { label: 'Week-end à la mer', amount: 340, cat: 'Voyages & Cadeaux', day: 22 },
    { label: 'Cadeau anniversaire', amount: 75, cat: 'Voyages & Cadeaux', day: 14 },
    { label: 'Réparation voiture', amount: 265, cat: 'Transport', day: 9 },
    { label: 'Nouveau canapé', amount: 480, cat: 'Loisirs', day: 18 },
    { label: 'Cadeaux de Noël', amount: 210, cat: 'Voyages & Cadeaux', day: 20 },
  ];
  let oneOffIdx = 0;

  for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo--) {
    const d = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 1);
    const mk = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

    // Revenus : base inégale + petite variation + prime/freelance occasionnels.
    incomeEntries.push({ id: `demo-inc-${iid++}`, couple_id: 'demo-couple', date: `${mk}-01`, source: 'salaire', description: 'Salaire', amount: round2(2350 + rand(-60, 60)), person: 'a' });
    incomeEntries.push({ id: `demo-inc-${iid++}`, couple_id: 'demo-couple', date: `${mk}-01`, source: 'salaire', description: 'Salaire', amount: round2(1680 + rand(-40, 40)), person: 'b' });
    if (monthsAgo === 4) incomeEntries.push({ id: `demo-inc-${iid++}`, couple_id: 'demo-couple', date: `${mk}-15`, source: 'prime', description: 'Prime annuelle', amount: 400, person: 'a' });
    if (monthsAgo === 2) incomeEntries.push({ id: `demo-inc-${iid++}`, couple_id: 'demo-couple', date: `${mk}-20`, source: 'freelance', description: 'Mission freelance', amount: 320, person: 'b' });

    // Récurrentes.
    expenses.push({ id: `demo-exp-${eid++}`, couple_id: 'demo-couple', date: `${mk}-03`, category_id: catId('Loyer'), description: 'Loyer + charges', amount: 950, paid_by: 'a', recurring_id: 'demo-rec-0' });
    expenses.push({ id: `demo-exp-${eid++}`, couple_id: 'demo-couple', date: `${mk}-05`, category_id: catId('Abonnements'), description: 'Netflix + Spotify', amount: 24.98, paid_by: 'b', recurring_id: 'demo-rec-1' });

    // Courses : 3 à 6 fois dans le mois, montants et payeur variables.
    const courseCount = randInt(3, 6);
    for (let i = 0; i < courseCount; i++) {
      const day = randInt(2, 27);
      expenses.push({ id: `demo-exp-${eid++}`, couple_id: 'demo-couple', date: `${mk}-${pad2(day)}`, category_id: catId('Courses'), description: pick(['Supermarché', 'Marché', 'Épicerie', 'Supermarché']), amount: round2(rand(22, 85)), paid_by: pick(['a', 'a', 'b']) });
    }
    // Transport : 1 à 2 fois.
    for (let i = 0; i < randInt(1, 2); i++) {
      expenses.push({ id: `demo-exp-${eid++}`, couple_id: 'demo-couple', date: `${mk}-${pad2(randInt(6, 24))}`, category_id: catId('Transport'), description: pick(["Plein d'essence", 'Ticket de métro', 'Parking']), amount: round2(rand(18, 75)), paid_by: 'a' });
    }
    // Restaurants : 1 à 3 fois.
    for (let i = 0; i < randInt(1, 3); i++) {
      expenses.push({ id: `demo-exp-${eid++}`, couple_id: 'demo-couple', date: `${mk}-${pad2(randInt(3, 28))}`, category_id: catId('Restaurants'), description: pick(['Restaurant', 'Livraison', 'Brunch']), amount: round2(rand(22, 70)), paid_by: pick(['a', 'b']) });
    }
    // Loisirs : 0 à 2 fois.
    for (let i = 0; i < randInt(0, 2); i++) {
      expenses.push({ id: `demo-exp-${eid++}`, couple_id: 'demo-couple', date: `${mk}-${pad2(randInt(5, 26))}`, category_id: catId('Loisirs'), description: pick(['Cinéma', 'Concert', 'Abonnement sport']), amount: round2(rand(15, 55)), paid_by: pick(['a', 'b']) });
    }
    // Santé : occasionnel.
    if (Math.random() < 0.55) {
      expenses.push({ id: `demo-exp-${eid++}`, couple_id: 'demo-couple', date: `${mk}-${pad2(randInt(4, 24))}`, category_id: catId('Santé'), description: pick(['Pharmacie', 'Médecin', 'Dentiste']), amount: round2(rand(12, 60)), paid_by: pick(['a', 'b']) });
    }
    // Un ponctuel plus gros, un mois sur deux environ.
    if (monthsAgo !== 5 && Math.random() < 0.65) {
      const oo = oneOffs[oneOffIdx++ % oneOffs.length];
      expenses.push({ id: `demo-exp-${eid++}`, couple_id: 'demo-couple', date: `${mk}-${pad2(oo.day)}`, category_id: catId(oo.cat), description: oo.label, amount: oo.amount, paid_by: pick(['a', 'b']) });
    }

    // Versements ponctuels de rééquilibrage, deux fois sur la période.
    if (monthsAgo === 3 || monthsAgo === 1) {
      settlements.push({ id: `demo-settle-${sid++}`, couple_id: 'demo-couple', date: `${mk}-27`, amount: randInt(60, 160), debtor: pick(['a', 'b']), creditor: null, note: 'Rééquilibrage' });
    }
  }
  // Le créditeur de chaque versement est simplement l'autre personne que le débiteur.
  settlements.forEach(s => { s.creditor = s.debtor === 'a' ? 'b' : 'a'; });

  store.expenses = expenses.sort((a, b) => b.date.localeCompare(a.date));
  store.incomeEntries = incomeEntries.sort((a, b) => b.date.localeCompare(a.date));
  store.settlements = settlements.sort((a, b) => b.date.localeCompare(a.date));

  store.recurring = [
    { id: 'demo-rec-0', couple_id: 'demo-couple', description: 'Loyer + charges', category_id: catId('Loyer'), amount: 950, paid_by: 'a', day_of_month: 3, active: true, start_month: `${today.getFullYear()}-01-01` },
    { id: 'demo-rec-1', couple_id: 'demo-couple', description: 'Netflix + Spotify', category_id: catId('Abonnements'), amount: 24.98, paid_by: 'b', day_of_month: 5, active: true, start_month: `${today.getFullYear()}-01-01` },
  ];
}

async function refetchCategories() {
  const { data, error } = await supabase.from('categories').select('*').eq('couple_id', store.coupleId).order('created_at');
  if (error) throw error;
  store.categories = data;
}
async function refetchExpenses() {
  const { data, error } = await supabase.from('expenses').select('*').eq('couple_id', store.coupleId).order('date', { ascending: false });
  if (error) throw error;
  store.expenses = data;
}
async function refetchIncome() {
  const { data, error } = await supabase.from('income_entries').select('*').eq('couple_id', store.coupleId).order('date', { ascending: false });
  if (error) throw error;
  store.incomeEntries = data;
}
async function refetchSettlements() {
  const { data, error } = await supabase.from('settlements').select('*').eq('couple_id', store.coupleId).order('date', { ascending: false });
  if (error) throw error;
  store.settlements = data;
}
async function refetchRecurring() {
  const { data, error } = await supabase.from('recurring_expenses').select('*').eq('couple_id', store.coupleId).order('created_at');
  if (error) throw error;
  store.recurring = data;
}

// ----------------------------------------------------------------------------
// Dépenses récurrentes : génère les occurrences manquantes jusqu'au mois réel courant.
//
// Le tri "already exists dans store.expenses" ci-dessous ne suffit pas à lui seul à
// empêcher les doublons : deux appels concurrents (ex. deux appareils ouverts au même
// moment, ou un boot() dupliqué côté client) peuvent tous les deux constater l'absence
// d'une occurrence avant que l'un des deux n'ait fini de l'insérer. On s'appuie donc en
// plus sur une contrainte unique côté base (recurring_id, date — voir schema.sql) et un
// upsert "ignore les doublons" : même en cas de course, un seul exemplaire survit.
// ----------------------------------------------------------------------------
export async function generateRecurringOccurrences() {
  const nowMk = currentMonthKey();
  const rows = [];
  store.recurring.forEach(tpl => {
    if (!tpl.active) return;
    let mk = monthKey(tpl.start_month);
    while (mk <= nowMk) {
      const already = store.expenses.some(e => e.recurring_id === tpl.id && monthKey(e.date) === mk);
      if (!already) {
        const day = Math.min(tpl.day_of_month, daysInRealMonth(mk));
        rows.push({
          couple_id: store.coupleId,
          category_id: tpl.category_id,
          date: `${mk}-${String(day).padStart(2, '0')}`,
          description: tpl.description,
          amount: tpl.amount,
          paid_by: tpl.paid_by,
          recurring_id: tpl.id,
        });
      }
      const [y, m] = mk.split('-').map(Number);
      mk = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }
  });
  if (rows.length) {
    const { error } = await supabase
      .from('expenses')
      .upsert(rows, { onConflict: 'recurring_id,date', ignoreDuplicates: true });
    if (error) throw error;
    await refetchExpenses();
  }
}

// ----------------------------------------------------------------------------
// Réglages du couple
// ----------------------------------------------------------------------------
export async function setNames(aName, bName) {
  demoGuard();
  store.memberAName = aName; store.memberBName = bName;
  const { error } = await supabase.from('couples').update({ member_a_name: aName, member_b_name: bName }).eq('id', store.coupleId);
  if (error) throw error;
}
export async function setSplitMode(mode) {
  demoGuard();
  store.splitMode = mode;
  const { error } = await supabase.from('couples').update({ split_mode: mode }).eq('id', store.coupleId);
  if (error) throw error;
}

// ----------------------------------------------------------------------------
// Dépenses
// ----------------------------------------------------------------------------
export async function addExpense({ date, categoryId, description, amount, paidBy }) {
  demoGuard();
  const { data, error } = await supabase.from('expenses').insert({
    couple_id: store.coupleId, date, category_id: categoryId, description, amount, paid_by: paidBy,
  }).select().single();
  if (error) throw error;
  store.expenses.unshift(data);
  notify();
}
export async function updateExpense(id, { date, categoryId, description, amount, paidBy }) {
  demoGuard();
  const { error } = await supabase.from('expenses').update({
    date, category_id: categoryId, description, amount, paid_by: paidBy,
  }).eq('id', id);
  if (error) throw error;
  await refetchExpenses();
  notify();
}
export async function deleteExpense(id) {
  demoGuard();
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;
  store.expenses = store.expenses.filter(e => e.id !== id);
  notify();
}

// ----------------------------------------------------------------------------
// Revenus
// ----------------------------------------------------------------------------
export async function addIncome({ date, source, description, amount, person }) {
  demoGuard();
  const { data, error } = await supabase.from('income_entries').insert({
    couple_id: store.coupleId, date, source, description, amount, person,
  }).select().single();
  if (error) throw error;
  store.incomeEntries.unshift(data);
  notify();
}
export async function updateIncome(id, { date, source, description, amount, person }) {
  demoGuard();
  const { error } = await supabase.from('income_entries').update({ date, source, description, amount, person }).eq('id', id);
  if (error) throw error;
  await refetchIncome();
  notify();
}
export async function deleteIncome(id) {
  demoGuard();
  const { error } = await supabase.from('income_entries').delete().eq('id', id);
  if (error) throw error;
  store.incomeEntries = store.incomeEntries.filter(e => e.id !== id);
  notify();
}

// ----------------------------------------------------------------------------
// Versements
// ----------------------------------------------------------------------------
export async function addSettlement({ date, amount, debtor, creditor, note }) {
  demoGuard();
  const { data, error } = await supabase.from('settlements').insert({
    couple_id: store.coupleId, date, amount, debtor, creditor, note,
  }).select().single();
  if (error) throw error;
  store.settlements.unshift(data);
  notify();
}
export async function updateSettlement(id, { date, amount, debtor, creditor, note }) {
  demoGuard();
  const { error } = await supabase.from('settlements').update({ date, amount, debtor, creditor, note }).eq('id', id);
  if (error) throw error;
  await refetchSettlements();
  notify();
}
export async function deleteSettlement(id) {
  demoGuard();
  const { error } = await supabase.from('settlements').delete().eq('id', id);
  if (error) throw error;
  store.settlements = store.settlements.filter(s => s.id !== id);
  notify();
}

// ----------------------------------------------------------------------------
// Dépenses récurrentes
// ----------------------------------------------------------------------------
export async function addRecurring({ description, categoryId, amount, paidBy, dayOfMonth, active }) {
  demoGuard();
  const { data, error } = await supabase.from('recurring_expenses').insert({
    couple_id: store.coupleId, description, category_id: categoryId, amount, paid_by: paidBy,
    day_of_month: dayOfMonth, active, start_month: `${currentMonthKey()}-01`,
  }).select().single();
  if (error) throw error;
  store.recurring.push(data);
  await generateRecurringOccurrences();
  notify();
}
export async function updateRecurring(id, { description, categoryId, amount, paidBy, dayOfMonth, active }) {
  demoGuard();
  const { error } = await supabase.from('recurring_expenses').update({
    description, category_id: categoryId, amount, paid_by: paidBy, day_of_month: dayOfMonth, active,
  }).eq('id', id);
  if (error) throw error;
  await refetchRecurring();
  await generateRecurringOccurrences();
  notify();
}
export async function setRecurringActive(id, active) {
  demoGuard();
  const { error } = await supabase.from('recurring_expenses').update({ active }).eq('id', id);
  if (error) throw error;
  await refetchRecurring();
  if (active) await generateRecurringOccurrences();
  notify();
}
export async function deleteRecurring(id) {
  demoGuard();
  // Le modèle est supprimé, mais les dépenses déjà générées restent (recurring_id passe à null via ON DELETE SET NULL).
  const { error } = await supabase.from('recurring_expenses').delete().eq('id', id);
  if (error) throw error;
  store.recurring = store.recurring.filter(r => r.id !== id);
  await refetchExpenses();
  notify();
}

// ----------------------------------------------------------------------------
// Catégories
// ----------------------------------------------------------------------------
export async function addCategory({ label, icon }) {
  demoGuard();
  const color = '--s' + ((store.categories.length % 8) + 1);
  const { data, error } = await supabase.from('categories').insert({
    couple_id: store.coupleId, label, icon, color,
  }).select().single();
  if (error) throw error;
  store.categories.push(data);
  notify();
}
export async function updateCategory(id, { label, icon }) {
  demoGuard();
  const { error } = await supabase.from('categories').update({ label, icon }).eq('id', id);
  if (error) throw error;
  await refetchCategories();
  notify();
}
// Réaffecte toutes les dépenses/récurrences de fromId vers toId, puis supprime fromId.
export async function reassignAndDeleteCategory(fromId, toId) {
  demoGuard();
  const { error: e1 } = await supabase.from('expenses').update({ category_id: toId }).eq('category_id', fromId).eq('couple_id', store.coupleId);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('recurring_expenses').update({ category_id: toId }).eq('category_id', fromId).eq('couple_id', store.coupleId);
  if (e2) throw e2;
  const { error: e3 } = await supabase.from('categories').delete().eq('id', fromId);
  if (e3) throw e3;
  await Promise.all([refetchExpenses(), refetchRecurring(), refetchCategories()]);
  notify();
}
export async function deleteCategory(id) {
  demoGuard();
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
  store.categories = store.categories.filter(c => c.id !== id);
  notify();
}

export function catOf(id) { return store.categories.find(c => c.id === id); }
export function nameOf(role) { return role === 'a' ? store.memberAName : store.memberBName; }
