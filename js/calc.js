// ============================================================================
// Logique de calcul du solde — port fidèle des fonctions validées dans le prototype
// (voir ensemble-prototype.html). Seuls changements : les rôles "remy"/"partner" du
// prototype deviennent "a"/"b" (génériques, mappés aux vrais prénoms côté UI), et il
// n'y a plus de tableau MONTHS figé — le temps est réel, pas simulé sur 6 mois de démo.
//
// Toutes les fonctions sont pures : elles prennent en entrée les tableaux de données
// (expenses, incomeEntries, settlements) et ne mutent rien.
// ============================================================================

export function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

export function currentMonthKey() {
  return monthKey(new Date().toISOString().slice(0, 10));
}

// Liste triée (chronologique) de tous les mois "pertinents" : du premier mois où il existe
// une donnée (dépense, revenu ou versement) jusqu'au mois réel actuel inclus — pour que la
// navigation par mois dans l'Historique couvre toujours au moins le mois en cours, même vide.
export function allMonthsInRange({ expenses, incomeEntries, settlements }) {
  const keys = new Set([currentMonthKey()]);
  expenses.forEach(e => keys.add(monthKey(e.date)));
  incomeEntries.forEach(e => keys.add(monthKey(e.date)));
  settlements.forEach(s => keys.add(monthKey(s.date)));
  const sorted = Array.from(keys).sort();
  // Comble les trous (ex: janvier et mars ont des données mais pas février) pour une navigation continue.
  const [firstY, firstM] = sorted[0].split('-').map(Number);
  const [lastY, lastM] = sorted[sorted.length - 1].split('-').map(Number);
  const out = [];
  let y = firstY, m = firstM;
  while (y < lastY || (y === lastY && m <= lastM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function incomesFor(incomeEntries, mk) {
  const entries = incomeEntries.filter(e => monthKey(e.date) === mk);
  const a = entries.filter(e => e.person === 'a').reduce((s, e) => s + e.amount, 0);
  const b = entries.filter(e => e.person === 'b').reduce((s, e) => s + e.amount, 0);
  return { a, b };
}

// Cumul "à date" : tous les revenus depuis le tout premier mois jusqu'à mk inclus.
export function cumulativeIncomesThrough(incomeEntries, mk) {
  const entries = incomeEntries.filter(e => monthKey(e.date) <= mk);
  const a = entries.filter(e => e.person === 'a').reduce((s, e) => s + e.amount, 0);
  const b = entries.filter(e => e.person === 'b').reduce((s, e) => s + e.amount, 0);
  return { a, b };
}

export function cumulativeIncomeRatioThrough(incomeEntries, mk) {
  const inc = cumulativeIncomesThrough(incomeEntries, mk);
  const total = inc.a + inc.b;
  if (total <= 0) return { a: 0.5, b: 0.5 };
  return { a: inc.a / total, b: inc.b / total };
}

export function monthIncomeRatio(incomeEntries, mk) {
  const inc = incomesFor(incomeEntries, mk);
  const total = inc.a + inc.b;
  if (total <= 0) return { a: 0.5, b: 0.5 };
  return { a: inc.a / total, b: inc.b / total };
}

// splitMode : "5050" | "monthly" | "cumulative"
export function fairShareRatioForMonth(incomeEntries, splitMode, mk) {
  if (splitMode === '5050') return { a: 0.5, b: 0.5 };
  if (splitMode === 'monthly') return monthIncomeRatio(incomeEntries, mk);
  if (splitMode === 'cumulative') return cumulativeIncomeRatioThrough(incomeEntries, mk);
  return { a: 0.5, b: 0.5 };
}

export function fairShareRatio(incomeEntries, splitMode, exp) {
  return fairShareRatioForMonth(incomeEntries, splitMode, monthKey(exp.date));
}

// Contribution des seules dépenses du mois mk à la position de "a" (positif = b lui doit plus).
export function monthOwnDelta(expenses, incomeEntries, splitMode, mk) {
  let net = 0;
  expenses.filter(e => monthKey(e.date) === mk).forEach(exp => {
    const r = fairShareRatio(incomeEntries, splitMode, exp);
    const fairA = exp.amount * r.a;
    const fairB = exp.amount * r.b;
    if (exp.paid_by === 'a') { net += fairB; } else { net -= fairA; }
  });
  return net;
}

export function monthSettlementDelta(settlements, mk) {
  let net = 0;
  settlements.filter(s => monthKey(s.date) === mk).forEach(s => {
    net += (s.debtor === 'b') ? -s.amount : s.amount;
  });
  return net;
}

export function expensesBeforeMonth(expenses, mk) {
  let a = 0, b = 0;
  expenses.forEach(exp => {
    if (monthKey(exp.date) >= mk) return;
    if (exp.paid_by === 'a') a += exp.amount; else b += exp.amount;
  });
  return { a, b };
}

export function settlementNetBeforeMonth(settlements, mk, person) {
  let net = 0;
  settlements.forEach(s => {
    if (monthKey(s.date) >= mk) return;
    net += (s.debtor === person) ? s.amount : -s.amount;
  });
  return net;
}

// Solde précédent (mois M) : voir le raisonnement détaillé dans ensemble-prototype.html
// (fonction previousBalance). D_R − P_R, avec le prorata du mois M appliqué à l'agrégat pré-M.
export function previousBalance({ expenses, incomeEntries, settlements, splitMode }, mk) {
  const before = expensesBeforeMonth(expenses, mk);
  const total = before.a + before.b;
  const ratio = fairShareRatioForMonth(incomeEntries, splitMode, mk);
  const targetA = ratio.a * total;
  const D_A = before.a + settlementNetBeforeMonth(settlements, mk, 'a');
  return D_A - targetA;
}

// Solde total actuel (positif = b doit à a), au mois réel courant — même calcul que la ligne
// "Solde total" de l'Historique pour ce mois, pour que Accueil et Historique concordent toujours.
export function currentTotalBalance(data) {
  const mk = currentMonthKey();
  return previousBalance(data, mk) + monthOwnDelta(data.expenses, data.incomeEntries, data.splitMode, mk)
    + monthSettlementDelta(data.settlements, mk);
}

export function daysInRealMonth(mk) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
