// ============================================================================
// Couche de données : synchronise l'état local avec Supabase (fetch initial + realtime),
// et expose des méthodes CRUD utilisées par l'UI. Le reste de l'app (calc.js, ui.js)
// travaille sur `store.*`, qui a la même forme que le `state` du prototype à ceci près :
// paid_by / person / debtor / creditor valent "a" ou "b" (pas "remy"/"partner").
// ============================================================================
import { supabase } from './supabase-client.js';
import { monthKey, currentMonthKey, daysInRealMonth } from './calc.js';

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
  store.coupleId = coupleId;
  store.myRole = myRole;

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
// Dépenses récurrentes : génère les occurrences manquantes jusqu'au mois réel courant
// (idempotent — ne duplique jamais une occurrence déjà créée pour un modèle+mois donnés).
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
    const { error } = await supabase.from('expenses').insert(rows);
    if (error) throw error;
    await refetchExpenses();
  }
}

// ----------------------------------------------------------------------------
// Réglages du couple
// ----------------------------------------------------------------------------
export async function setNames(aName, bName) {
  store.memberAName = aName; store.memberBName = bName;
  const { error } = await supabase.from('couples').update({ member_a_name: aName, member_b_name: bName }).eq('id', store.coupleId);
  if (error) throw error;
}
export async function setSplitMode(mode) {
  store.splitMode = mode;
  const { error } = await supabase.from('couples').update({ split_mode: mode }).eq('id', store.coupleId);
  if (error) throw error;
}

// ----------------------------------------------------------------------------
// Dépenses
// ----------------------------------------------------------------------------
export async function addExpense({ date, categoryId, description, amount, paidBy }) {
  const { data, error } = await supabase.from('expenses').insert({
    couple_id: store.coupleId, date, category_id: categoryId, description, amount, paid_by: paidBy,
  }).select().single();
  if (error) throw error;
  store.expenses.unshift(data);
  notify();
}
export async function updateExpense(id, { date, categoryId, description, amount, paidBy }) {
  const { error } = await supabase.from('expenses').update({
    date, category_id: categoryId, description, amount, paid_by: paidBy,
  }).eq('id', id);
  if (error) throw error;
  await refetchExpenses();
  notify();
}
export async function deleteExpense(id) {
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;
  store.expenses = store.expenses.filter(e => e.id !== id);
  notify();
}

// ----------------------------------------------------------------------------
// Revenus
// ----------------------------------------------------------------------------
export async function addIncome({ date, source, description, amount, person }) {
  const { data, error } = await supabase.from('income_entries').insert({
    couple_id: store.coupleId, date, source, description, amount, person,
  }).select().single();
  if (error) throw error;
  store.incomeEntries.unshift(data);
  notify();
}
export async function updateIncome(id, { date, source, description, amount, person }) {
  const { error } = await supabase.from('income_entries').update({ date, source, description, amount, person }).eq('id', id);
  if (error) throw error;
  await refetchIncome();
  notify();
}
export async function deleteIncome(id) {
  const { error } = await supabase.from('income_entries').delete().eq('id', id);
  if (error) throw error;
  store.incomeEntries = store.incomeEntries.filter(e => e.id !== id);
  notify();
}

// ----------------------------------------------------------------------------
// Versements
// ----------------------------------------------------------------------------
export async function addSettlement({ date, amount, debtor, creditor, note }) {
  const { data, error } = await supabase.from('settlements').insert({
    couple_id: store.coupleId, date, amount, debtor, creditor, note,
  }).select().single();
  if (error) throw error;
  store.settlements.unshift(data);
  notify();
}
export async function updateSettlement(id, { date, amount, debtor, creditor, note }) {
  const { error } = await supabase.from('settlements').update({ date, amount, debtor, creditor, note }).eq('id', id);
  if (error) throw error;
  await refetchSettlements();
  notify();
}
export async function deleteSettlement(id) {
  const { error } = await supabase.from('settlements').delete().eq('id', id);
  if (error) throw error;
  store.settlements = store.settlements.filter(s => s.id !== id);
  notify();
}

// ----------------------------------------------------------------------------
// Dépenses récurrentes
// ----------------------------------------------------------------------------
export async function addRecurring({ description, categoryId, amount, paidBy, dayOfMonth, active }) {
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
  const { error } = await supabase.from('recurring_expenses').update({
    description, category_id: categoryId, amount, paid_by: paidBy, day_of_month: dayOfMonth, active,
  }).eq('id', id);
  if (error) throw error;
  await refetchRecurring();
  await generateRecurringOccurrences();
  notify();
}
export async function setRecurringActive(id, active) {
  const { error } = await supabase.from('recurring_expenses').update({ active }).eq('id', id);
  if (error) throw error;
  await refetchRecurring();
  if (active) await generateRecurringOccurrences();
  notify();
}
export async function deleteRecurring(id) {
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
  const color = '--s' + ((store.categories.length % 8) + 1);
  const { data, error } = await supabase.from('categories').insert({
    couple_id: store.coupleId, label, icon, color,
  }).select().single();
  if (error) throw error;
  store.categories.push(data);
  notify();
}
export async function updateCategory(id, { label, icon }) {
  const { error } = await supabase.from('categories').update({ label, icon }).eq('id', id);
  if (error) throw error;
  await refetchCategories();
  notify();
}
// Réaffecte toutes les dépenses/récurrences de fromId vers toId, puis supprime fromId.
export async function reassignAndDeleteCategory(fromId, toId) {
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
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
  store.categories = store.categories.filter(c => c.id !== id);
  notify();
}

export function catOf(id) { return store.categories.find(c => c.id === id); }
export function nameOf(role) { return role === 'a' ? store.memberAName : store.memberBName; }
