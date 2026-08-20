// ============================================================================
// Ensemble — application principale.
// Port du prototype (ensemble-prototype.html) sur une vraie base Supabase partagée.
// Les rôles "Rémy"/"Camille" du prototype deviennent génériques "a"/"b", mappés aux
// vrais prénoms via store.memberAName / store.memberBName.
// ============================================================================
"use strict";

import { supabase } from './supabase-client.js';
import * as auth from './auth.js';
import * as calc from './calc.js';
import { store, onStoreChange, loadCouple, catOf, nameOf,
  addExpense, updateExpense, deleteExpense,
  addIncome, updateIncome, deleteIncome,
  addSettlement, updateSettlement, deleteSettlement,
  addRecurring, updateRecurring, deleteRecurring, setRecurringActive,
  addCategory, updateCategory, deleteCategory, reassignAndDeleteCategory,
  setNames, setSplitMode } from './store.js';

/* ---------- formatage ---------- */
function fmtMoney(n){ return n.toLocaleString('fr-FR',{style:'currency',currency:'EUR'}); }
function fmtPct(n){ return n.toLocaleString('fr-FR',{minimumFractionDigits:1,maximumFractionDigits:1}); }
function fmtDate(d){ const dt=new Date(d+"T00:00:00"); return dt.toLocaleDateString('fr-FR',{day:'numeric',month:'short'}); }
function fmtMonthLabel(mk){ const dt=new Date(mk+"-01T00:00:00"); return dt.toLocaleDateString('fr-FR',{month:'long',year:'numeric'}); }
function todayStr(){ return new Date().toISOString().slice(0,10); }

// Les 6 derniers mois calendaires réels se terminant au mois courant (indépendant des données présentes),
// utilisés pour les graphiques "tendance" dont l'axe X doit rester stable.
function trailingMonths(n){
  const [y0,m0] = calc.currentMonthKey().split('-').map(Number);
  const out = [];
  for(let i=n-1;i>=0;i--){
    let yy=y0, mm=m0-i;
    while(mm<=0){ mm+=12; yy--; }
    out.push(`${yy}-${String(mm).padStart(2,'0')}`);
  }
  return out;
}

const INCOME_SOURCES = [
  {id:"salaire", label:"Salaire", icon:"💼", color:"--s1"},
  {id:"freelance", label:"Freelance", icon:"💻", color:"--s2"},
  {id:"prime", label:"Prime", icon:"🎁", color:"--s3"},
  {id:"aide", label:"Aide / alloc.", icon:"🏛️", color:"--s4"},
  {id:"autre", label:"Autre revenu", icon:"📥", color:"--s5"},
];
function sourceOf(id){ return INCOME_SOURCES.find(s=>s.id===id); }

const CATEGORY_ICONS = [
  "🏠","🏡","🏢","🏦","🔑","🏗️",
  "🚗","🚕","🚌","🚆","✈️","🚲","⛽","🅿️",
  "🛒","🍽️","🍔","🍕","☕","🍺","🍷","🎂",
  "🎉","🎬","🎮","🎵","📚","🎓","🎨","📷",
  "💡","📱","💻","🌐","💧","🔥","📺",
  "💊","🩺","🏥","🦷","🧴",
  "👶","🐾","👕","👗","💄","✂️",
  "🏋️","⚽","🚴","🏖️","⛺",
  "🎁","💍","🛡️","💳","🧾","📦","🔧","🧹","♻️","⭐","📌","❤️",
];

const SPLIT_MODES = [
  {id:"5050", title:"50 / 50", desc:"Chaque dépense est partagée à parts égales entre vous deux."},
  {id:"monthly", title:"Prorata mois par mois", desc:"Chaque dépense est répartie selon les revenus du mois où elle a eu lieu."},
  {id:"cumulative", title:"Prorata cumulé", desc:"Chaque dépense est répartie selon le cumul de tous les revenus enregistrés à ce jour — recalculé en continu."},
];
function splitModeLabel(id){ const m = SPLIT_MODES.find(x=>x.id===id); return m ? m.title : id; }

const RATIO_CHART_RANGES = [
  {id:"6m", label:"6 mois", months:6},
  {id:"1y", label:"1 an", months:12},
  {id:"5y", label:"5 ans", months:60},
  {id:"10y", label:"10 ans", months:120},
  {id:"max", label:"Max", months:Infinity},
];
let ratioChartRange = "6m";

/* ---------- calc helpers liés au store courant ---------- */
function calcData(){
  return { expenses: store.expenses, incomeEntries: store.incomeEntries, settlements: store.settlements, splitMode: store.splitMode };
}
function fairShareRatio(exp){ return calc.fairShareRatioForMonth(store.incomeEntries, store.splitMode, calc.monthKey(exp.date)); }

/* ============================================================================
   RENDU
   ============================================================================ */
function renderExpenseRow(exp){
  const cat = catOf(exp.category_id);
  const payerName = nameOf(exp.paid_by);
  const r = fairShareRatio(exp);
  const otherRole = exp.paid_by === 'a' ? 'b' : 'a';
  const owed = exp.amount * r[otherRole];
  const div = document.createElement("div");
  div.className = "expense-row";
  div.innerHTML = `
    <div class="cat-icon" style="background:color-mix(in srgb, var(${cat.color}) 18%, transparent);">${cat.icon}</div>
    <div class="expense-info">
      <div class="expense-desc">${exp.recurring_id ? '🔁 ' : ''}${exp.description}</div>
      <div class="expense-meta">${fmtDate(exp.date)} · ${cat.label} · payé par ${payerName}</div>
    </div>
    <div class="expense-amount">${fmtMoney(exp.amount)}<span class="who">${nameOf(otherRole)} doit ${fmtMoney(owed)}</span></div>
  `;
  div.addEventListener('click', ()=>openEditModal('expense', exp.id));
  return div;
}

function renderHome(){
  const net = calc.currentTotalBalance(calcData());
  const amountEl = document.getElementById("homeBalanceAmount");
  const labelEl = document.getElementById("homeBalanceLabel");
  const subEl = document.getElementById("homeBalanceSub");
  const settleBtn = document.getElementById("settleBtn");
  const abs = Math.abs(net);
  if(Math.round(abs*100)===0){
    amountEl.textContent = fmtMoney(0);
    amountEl.className = "balance-amount zero";
    labelEl.textContent = "Vous êtes à jour";
    subEl.textContent = "Aucune somme en attente entre vous deux.";
    settleBtn.disabled = true;
  } else if(net > 0){
    amountEl.textContent = fmtMoney(abs);
    amountEl.className = "balance-amount good";
    labelEl.textContent = `${store.memberBName} doit à ${store.memberAName}`;
    subEl.textContent = `Solde total, comme dans l'Historique (mode « ${splitModeLabel(store.splitMode)} »).`;
    settleBtn.disabled = false;
  } else {
    amountEl.textContent = fmtMoney(abs);
    amountEl.className = "balance-amount critical";
    labelEl.textContent = `${store.memberAName} doit à ${store.memberBName}`;
    subEl.textContent = `Solde total, comme dans l'Historique (mode « ${splitModeLabel(store.splitMode)} »).`;
    settleBtn.disabled = false;
  }

  const recentList = document.getElementById("recentList");
  recentList.innerHTML = "";
  store.expenses.slice(0,6).forEach(e=>recentList.appendChild(renderExpenseRow(e)));
  if(!store.expenses.length) recentList.innerHTML = "<div class=\"empty\">Aucune dépense pour l'instant.</div>";
}

// Mois sélectionné dans l'Historique, gardé par CLÉ (pas par index) pour rester stable
// même si de nouveaux mois apparaissent (ex: le/la partenaire ajoute une dépense ailleurs).
let historyMonthKey = calc.currentMonthKey();
// Lignes dépliées (clé "mk:income", "mk:cat:<id>", "mk:settlements") — persiste entre les re-rendus.
const expandedKeys = new Set();

function renderHistory(){
  const months = calc.allMonthsInRange(store);
  let idx = months.indexOf(historyMonthKey);
  if(idx === -1){ idx = months.length - 1; historyMonthKey = months[idx]; }
  const mk = months[idx];

  document.getElementById('histMonthLabel').textContent = fmtMonthLabel(mk);
  document.getElementById('histPrevMonth').disabled = idx <= 0;
  document.getElementById('histNextMonth').disabled = idx >= months.length - 1;

  const head = document.getElementById('mtableHead');
  head.innerHTML = `
    <div class="mt-rowlabel">Par mois</div>
    <div class="mt-col">${store.memberAName}</div>
    <div class="mt-col">${store.memberBName}</div>
  `;

  const body = document.getElementById('mtableBody');
  body.innerHTML = "";

  const inc = calc.incomesFor(store.incomeEntries, mk);
  const monthIncomes = store.incomeEntries.filter(e=>calc.monthKey(e.date)===mk);
  const incKey = `${mk}:income`;
  const incExpanded = expandedKeys.has(incKey);
  const incRow = document.createElement('div');
  incRow.className = 'mtable-row mt-income mt-expandable' + (incExpanded ? ' mt-expanded' : '');
  incRow.innerHTML = `
    <div class="mt-label"><div class="mt-icon" style="background:color-mix(in srgb, var(--good) 16%, transparent);">💶</div>Revenus<span class="mtable-chevron">▸</span></div>
    <div class="mt-col">${fmtMoney(inc.a)}</div>
    <div class="mt-col">${fmtMoney(inc.b)}</div>
  `;
  incRow.addEventListener('click', ()=>{
    if(expandedKeys.has(incKey)) expandedKeys.delete(incKey); else expandedKeys.add(incKey);
    renderHistory();
  });
  body.appendChild(incRow);
  if(incExpanded){
    if(!monthIncomes.length){
      body.insertAdjacentHTML('beforeend', '<div class="empty" style="padding:10px 16px;">Aucun revenu ce mois-ci.</div>');
    } else {
      monthIncomes.slice().sort((a,b)=> a.date < b.date ? 1 : -1).forEach(entry=>{
        const src = sourceOf(entry.source);
        const item = document.createElement('div');
        item.className = 'mtable-row mtable-item';
        item.innerHTML = `
          <div class="mt-label">${src?src.icon:'💶'} ${entry.description||''} <span class="muted" style="font-weight:400;">· ${fmtDate(entry.date)}</span></div>
          <div class="mt-col">${entry.person==='a'?fmtMoney(entry.amount):'—'}</div>
          <div class="mt-col">${entry.person==='b'?fmtMoney(entry.amount):'—'}</div>
        `;
        item.addEventListener('click', (e)=>{ e.stopPropagation(); openEditModal('income', entry.id); });
        body.appendChild(item);
      });
    }
  }

  const monthlyBadge = store.splitMode === "monthly" ? '<span class="mode-active-badge">actif</span>' : '';
  const cumulativeBadge = store.splitMode === "cumulative" ? '<span class="mode-active-badge">actif</span>' : '';
  const monthTotal = inc.a + inc.b;
  const ratioRow = document.createElement('div');
  ratioRow.className = 'mtable-row mt-ratio';
  if(monthTotal <= 0){
    ratioRow.innerHTML = `
      <div class="mt-label"><div class="mt-icon" style="background:color-mix(in srgb, var(--accent) 16%, transparent);">%</div>Prorata du mois${monthlyBadge}</div>
      <div class="mt-col">—</div><div class="mt-col">—</div>
    `;
  } else {
    const pa = inc.a/monthTotal*100, pb = inc.b/monthTotal*100;
    ratioRow.innerHTML = `
      <div class="mt-label"><div class="mt-icon" style="background:color-mix(in srgb, var(--accent) 16%, transparent);">%</div>Prorata du mois${monthlyBadge}</div>
      <div class="mt-col">${fmtPct(pa)} %</div><div class="mt-col">${fmtPct(pb)} %</div>
    `;
  }
  body.appendChild(ratioRow);

  const cumInc = calc.cumulativeIncomesThrough(store.incomeEntries, mk);
  const cumTotal = cumInc.a + cumInc.b;
  const cumRow = document.createElement('div');
  cumRow.className = 'mtable-row mt-ratio mt-ratio-cum';
  if(cumTotal <= 0){
    cumRow.innerHTML = `
      <div class="mt-label"><div class="mt-icon" style="background:color-mix(in srgb, var(--s7) 16%, transparent);">Σ</div>Prorata cumulé${cumulativeBadge}</div>
      <div class="mt-col">—</div><div class="mt-col">—</div>
    `;
  } else {
    const cpa = cumInc.a/cumTotal*100, cpb = cumInc.b/cumTotal*100;
    cumRow.innerHTML = `
      <div class="mt-label"><div class="mt-icon" style="background:color-mix(in srgb, var(--s7) 16%, transparent);">Σ</div>Prorata cumulé${cumulativeBadge}</div>
      <div class="mt-col">${fmtPct(cpa)} %</div><div class="mt-col">${fmtPct(cpb)} %</div>
    `;
  }
  body.appendChild(cumRow);

  const monthExpenses = store.expenses.filter(e=>calc.monthKey(e.date)===mk);
  let totalA = 0, totalB = 0;
  let visibleCatRows = 0;
  store.categories.forEach(c=>{
    const catExp = monthExpenses.filter(e=>e.category_id===c.id);
    const aAmt = catExp.filter(e=>e.paid_by==="a").reduce((s,e)=>s+e.amount,0);
    const bAmt = catExp.filter(e=>e.paid_by==="b").reduce((s,e)=>s+e.amount,0);
    totalA += aAmt; totalB += bAmt;
    if(Math.round((aAmt+bAmt)*100)===0) return;
    visibleCatRows++;
    const catKey = `${mk}:cat:${c.id}`;
    const catExpanded = expandedKeys.has(catKey);
    const row = document.createElement('div');
    row.className = 'mtable-row mt-expandable' + (catExpanded ? ' mt-expanded' : '');
    row.innerHTML = `
      <div class="mt-label"><div class="mt-icon" style="background:color-mix(in srgb, var(${c.color}) 18%, transparent);">${c.icon}</div>${c.label}<span class="mtable-chevron">▸</span></div>
      <div class="mt-col">${fmtMoney(aAmt)}</div>
      <div class="mt-col">${fmtMoney(bAmt)}</div>
    `;
    row.addEventListener('click', ()=>{
      if(expandedKeys.has(catKey)) expandedKeys.delete(catKey); else expandedKeys.add(catKey);
      renderHistory();
    });
    body.appendChild(row);
    if(catExpanded){
      catExp.slice().sort((a,b)=> a.date < b.date ? 1 : -1).forEach(exp=>{
        const item = document.createElement('div');
        item.className = 'mtable-row mtable-item';
        item.innerHTML = `
          <div class="mt-label">${exp.recurring_id ? '🔁 ' : ''}${exp.description} <span class="muted" style="font-weight:400;">· ${fmtDate(exp.date)}</span></div>
          <div class="mt-col">${exp.paid_by==='a'?fmtMoney(exp.amount):'—'}</div>
          <div class="mt-col">${exp.paid_by==='b'?fmtMoney(exp.amount):'—'}</div>
        `;
        item.addEventListener('click', (e)=>{ e.stopPropagation(); openEditModal('expense', exp.id); });
        body.appendChild(item);
      });
    }
  });
  if(visibleCatRows === 0){
    body.insertAdjacentHTML('beforeend', '<div class="empty">Aucune dépense ce mois-ci.</div>');
  }

  const totalRow = document.createElement('div');
  totalRow.className = 'mtable-row mt-total';
  totalRow.innerHTML = `
    <div class="mt-label">Total dépenses payées</div>
    <div class="mt-col">${fmtMoney(totalA)}</div>
    <div class="mt-col">${fmtMoney(totalB)}</div>
  `;
  body.appendChild(totalRow);

  function signedAmt(v){
    if(Math.abs(v) < 0.005) return fmtMoney(0);
    return (v>0 ? "+" : "−") + fmtMoney(Math.abs(v));
  }
  function addBalanceRow(label, icon, aVal, bVal, extraClass, expandKey){
    const aCls = aVal > 0.005 ? "pos" : (aVal < -0.005 ? "neg" : "");
    const bCls = bVal > 0.005 ? "pos" : (bVal < -0.005 ? "neg" : "");
    const expandable = !!expandKey;
    const expanded = expandable && expandedKeys.has(expandKey);
    const r = document.createElement('div');
    r.className = 'mtable-row mt-balance' + (extraClass ? ' '+extraClass : '') + (expandable ? ' mt-expandable' : '') + (expanded ? ' mt-expanded' : '');
    r.innerHTML = `
      <div class="mt-label"><div class="mt-icon" style="background:color-mix(in srgb, var(--accent) 16%, transparent);">${icon}</div>${label}${expandable ? '<span class="mtable-chevron">▸</span>' : ''}</div>
      <div class="mt-col ${aCls}">${signedAmt(aVal)}</div>
      <div class="mt-col ${bCls}">${signedAmt(bVal)}</div>
    `;
    if(expandable){
      r.addEventListener('click', ()=>{
        if(expandedKeys.has(expandKey)) expandedKeys.delete(expandKey); else expandedKeys.add(expandKey);
        renderHistory();
      });
    }
    body.appendChild(r);
    return expanded;
  }

  const data = calcData();
  const prevBalance = calc.previousBalance(data, mk);
  const ownDelta = calc.monthOwnDelta(store.expenses, store.incomeEntries, store.splitMode, mk);
  const subtotal = prevBalance + ownDelta;
  const settleDelta = calc.monthSettlementDelta(store.settlements, mk);
  const totalBalance = subtotal + settleDelta;

  addBalanceRow('Solde précédent', '=', prevBalance, -prevBalance);
  addBalanceRow('Solde de ce mois', '+', ownDelta, -ownDelta);

  const monthSettlements = store.settlements.filter(s=>calc.monthKey(s.date)===mk);
  const settleKey = `${mk}:settlements`;
  const settleExpanded = addBalanceRow('Règlements', '✓', settleDelta, -settleDelta, null, monthSettlements.length ? settleKey : null);
  if(settleExpanded){
    monthSettlements.forEach(s=>{
      const aEffect = (s.debtor === "b") ? -s.amount : s.amount;
      const bEffect = -aEffect;
      const aCls = aEffect > 0.005 ? "pos" : (aEffect < -0.005 ? "neg" : "");
      const bCls = bEffect > 0.005 ? "pos" : (bEffect < -0.005 ? "neg" : "");
      const row = document.createElement('div');
      row.className = 'mtable-row mtable-subrow';
      row.innerHTML = `
        <div class="mt-label">↳ ${fmtDate(s.date)} · ${s.note||''}</div>
        <div class="mt-col ${aCls}">${signedAmt(aEffect)}</div>
        <div class="mt-col ${bCls}">${signedAmt(bEffect)}</div>
      `;
      row.addEventListener('click', (e)=>{ e.stopPropagation(); openEditModal('settlement', s.id); });
      body.appendChild(row);
    });
  }

  addBalanceRow('Solde total', 'Σ', totalBalance, -totalBalance, 'mt-balance-final');
}

document.getElementById('histPrevMonth').addEventListener('click', ()=>{
  const months = calc.allMonthsInRange(store);
  const idx = months.indexOf(historyMonthKey);
  if(idx > 0){ historyMonthKey = months[idx-1]; renderHistory(); }
});
document.getElementById('histNextMonth').addEventListener('click', ()=>{
  const months = calc.allMonthsInRange(store);
  const idx = months.indexOf(historyMonthKey);
  if(idx < months.length-1){ historyMonthKey = months[idx+1]; renderHistory(); }
});

function renderStats(){
  const mk = calc.currentMonthKey();
  document.getElementById("statsMonthLabel").textContent = fmtMonthLabel(mk);
  const monthExpenses = store.expenses.filter(e=>calc.monthKey(e.date)===mk);
  const total = monthExpenses.reduce((s,e)=>s+e.amount,0);
  document.getElementById("statsMonthTotal").textContent = fmtMoney(total);

  const byCat = {};
  store.categories.forEach(c=>byCat[c.id]=0);
  monthExpenses.forEach(e=>{ if(byCat[e.category_id]===undefined) byCat[e.category_id]=0; byCat[e.category_id]+=e.amount; });
  const maxVal = Math.max(1, ...Object.values(byCat));
  const catList = document.getElementById("catBarList");
  catList.innerHTML = "";
  store.categories
    .map(c=>({c, val: byCat[c.id]||0}))
    .filter(x=>x.val>0)
    .sort((a,b)=>b.val-a.val)
    .forEach(({c,val})=>{
      const row = document.createElement("div");
      row.className = "barlist-row";
      row.innerHTML = `
        <div class="barlist-top"><span>${c.icon} ${c.label}</span><strong>${fmtMoney(val)}</strong></div>
        <div class="barlist-track"><div class="barlist-fill" style="width:${(val/maxVal*100).toFixed(1)}%; background:var(${c.color});"></div></div>
      `;
      catList.appendChild(row);
    });
  if(!Object.values(byCat).some(v=>v>0)){
    catList.innerHTML = '<div class="empty">Pas de dépense ce mois-ci.</div>';
  }

  renderRatioTrendChart();
  renderTrendChart();
  renderPaidBars();
}

function monthlyTotals(months){
  return months.map(mk=>{
    const exps = store.expenses.filter(e=>calc.monthKey(e.date)===mk);
    return {mk, total: exps.reduce((s,e)=>s+e.amount,0)};
  });
}

function svgColor(varName){ return getComputedStyle(document.documentElement).getPropertyValue(varName).trim(); }

function renderTrendChart(){
  const data = monthlyTotals(trailingMonths(6));
  const wrap = document.getElementById("trendChartWrap");
  wrap.innerHTML = "";
  const W = 380, H = 150, padL = 8, padR = 8, padT = 16, padB = 26;
  const maxV = Math.max(...data.map(d=>d.total), 1) * 1.12;
  const stepX = (W - padL - padR) / (data.length - 1);
  const xFor = i => padL + i*stepX;
  const yFor = v => padT + (H - padT - padB) * (1 - v/maxV);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.style.display = "block";
  svg.style.overflow = "visible";

  const gridColor = svgColor('--grid');
  const baseColor = svgColor('--baseline');
  const mutedColor = svgColor('--muted');
  const accentColor = svgColor('--accent');

  for(let i=1;i<=2;i++){
    const v = maxV * i/3;
    const y = yFor(v);
    const line = document.createElementNS(svgNS,"line");
    line.setAttribute("x1",padL); line.setAttribute("x2",W-padR);
    line.setAttribute("y1",y); line.setAttribute("y2",y);
    line.setAttribute("stroke",gridColor); line.setAttribute("stroke-width","1");
    svg.appendChild(line);
  }
  const base = document.createElementNS(svgNS,"line");
  base.setAttribute("x1",padL); base.setAttribute("x2",W-padR);
  base.setAttribute("y1",yFor(0)); base.setAttribute("y2",yFor(0));
  base.setAttribute("stroke",baseColor); base.setAttribute("stroke-width","1");
  svg.appendChild(base);

  const pts = data.map((d,i)=>[xFor(i), yFor(d.total)]);
  const pathD = pts.map((p,i)=> (i===0?"M":"L")+p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
  const path = document.createElementNS(svgNS,"path");
  path.setAttribute("d", pathD);
  path.setAttribute("fill","none");
  path.setAttribute("stroke", accentColor);
  path.setAttribute("stroke-width","2");
  path.setAttribute("stroke-linecap","round");
  path.setAttribute("stroke-linejoin","round");
  svg.appendChild(path);

  pts.forEach((p,i)=>{
    const c = document.createElementNS(svgNS,"circle");
    c.setAttribute("cx",p[0]); c.setAttribute("cy",p[1]); c.setAttribute("r","4");
    c.setAttribute("fill", accentColor);
    svg.appendChild(c);

    const lbl = document.createElementNS(svgNS,"text");
    lbl.setAttribute("x",p[0]); lbl.setAttribute("y",H-6);
    lbl.setAttribute("text-anchor", i===0?"start":(i===pts.length-1?"end":"middle"));
    lbl.setAttribute("font-size","9.5");
    lbl.setAttribute("fill",mutedColor);
    lbl.textContent = new Date(data[i].mk+"-01T00:00:00").toLocaleDateString('fr-FR',{month:'short'});
    svg.appendChild(lbl);
  });

  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  wrap.appendChild(tooltip);

  const crosshair = document.createElementNS(svgNS,"line");
  crosshair.setAttribute("y1",padT); crosshair.setAttribute("y2",H-padB);
  crosshair.setAttribute("stroke",mutedColor); crosshair.setAttribute("stroke-width","1");
  crosshair.setAttribute("stroke-dasharray","2,2");
  crosshair.style.display = "none";
  svg.appendChild(crosshair);

  data.forEach((d,i)=>{
    const rect = document.createElementNS(svgNS,"rect");
    rect.setAttribute("x", xFor(i)-stepX/2);
    rect.setAttribute("y", 0);
    rect.setAttribute("width", stepX);
    rect.setAttribute("height", H);
    rect.setAttribute("fill","transparent");
    rect.style.cursor = "pointer";
    rect.addEventListener("mouseenter", ()=>showTip(i));
    rect.addEventListener("touchstart", ()=>{showTip(i);}, {passive:true});
    rect.addEventListener("mouseleave", hideTip);
    svg.appendChild(rect);
  });

  function showTip(i){
    crosshair.style.display = "block";
    crosshair.setAttribute("x1", pts[i][0]); crosshair.setAttribute("x2", pts[i][0]);
    const rectBox = svg.getBoundingClientRect();
    const relX = (pts[i][0]/W) * rectBox.width;
    tooltip.style.left = relX + "px";
    tooltip.style.top = (pts[i][1]/H)*rectBox.height + "px";
    tooltip.textContent = `${fmtMonthLabel(data[i].mk)} · ${fmtMoney(data[i].total)}`;
    tooltip.classList.add("show");
  }
  function hideTip(){ crosshair.style.display="none"; tooltip.classList.remove("show"); }

  wrap.appendChild(svg);
}

function ratioTrendData(rangeMonths){
  const monthsAvail = calc.allMonthsInRange(store).length;
  const n = (!rangeMonths || rangeMonths === Infinity) ? monthsAvail : Math.min(rangeMonths, monthsAvail);
  const months = trailingMonths(n);
  return months.map(mk=>({
    mk,
    monthly: calc.monthIncomeRatio(store.incomeEntries, mk).a * 100,
    cumulative: calc.cumulativeIncomeRatioThrough(store.incomeEntries, mk).a * 100,
  }));
}

function renderRatioRangeSelector(){
  const row = document.getElementById('ratioRangeRow');
  row.innerHTML = "";
  const monthsAvail = calc.allMonthsInRange(store).length;
  RATIO_CHART_RANGES.forEach(r=>{
    const enabled = r.id === "max" || monthsAvail >= r.months;
    const btn = document.createElement('button');
    btn.type = "button";
    btn.className = "filter-chip" + (ratioChartRange===r.id ? " active" : "");
    btn.textContent = r.label;
    btn.disabled = !enabled;
    if(enabled){
      btn.addEventListener('click', ()=>{
        ratioChartRange = r.id;
        renderRatioTrendChart();
      });
    }
    row.appendChild(btn);
  });
}

function renderRatioTrendChart(){
  renderRatioRangeSelector();
  const axisLabels = document.getElementById('ratioAxisLabels');
  axisLabels.innerHTML = `
    <span style="color:var(--text-primary);">${store.memberAName} ↗</span>
    <span style="color:var(--text-primary);">${store.memberBName} ↘</span>
  `;
  const legend = document.getElementById('ratioLegend');
  legend.innerHTML = `
    <div class="legend-item"><span class="legend-dot" style="background:var(--s1);"></span>Prorata du mois</div>
    <div class="legend-item"><span class="legend-dot" style="background:var(--s2);"></span>Prorata cumulé</div>
  `;

  const rangeDef = RATIO_CHART_RANGES.find(r=>r.id===ratioChartRange) || RATIO_CHART_RANGES[0];
  const data = ratioTrendData(rangeDef.months);
  const wrap = document.getElementById("ratioChartWrap");
  wrap.innerHTML = "";
  const W = 380, H = 150, padL = 8, padR = 8, padT = 16, padB = 26;

  const allVals = data.flatMap(d=>[d.monthly, d.cumulative]);
  const dataMin = Math.min(...allVals), dataMax = Math.max(...allVals);
  let minV = Math.max(0, dataMin - 5);
  let maxV = Math.min(100, dataMax + 5);
  if(maxV - minV < 1){ minV = Math.max(0, minV - 5); maxV = Math.min(100, maxV + 5); }

  const stepX = data.length > 1 ? (W - padL - padR) / (data.length - 1) : 0;
  const xFor = i => data.length > 1 ? padL + i*stepX : (padL + (W-padR))/2;
  const yFor = v => padT + (H - padT - padB) * (1 - (v-minV)/(maxV-minV));

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.style.display = "block";
  svg.style.overflow = "visible";

  const gridColor = svgColor('--grid');
  const baseColor = svgColor('--baseline');
  const mutedColor = svgColor('--muted');
  const s1Color = svgColor('--s1');
  const s2Color = svgColor('--s2');

  const ticks = [0,1,2,3,4].map(i => minV + (maxV-minV)*i/4);
  ticks.forEach((v,i)=>{
    const y = yFor(v);
    const line = document.createElementNS(svgNS,"line");
    line.setAttribute("x1",padL); line.setAttribute("x2",W-padR);
    line.setAttribute("y1",y); line.setAttribute("y2",y);
    const isEdge = i===0 || i===ticks.length-1;
    line.setAttribute("stroke", isEdge ? baseColor : gridColor);
    line.setAttribute("stroke-width","1");
    svg.appendChild(line);
    const lbl = document.createElementNS(svgNS,"text");
    lbl.setAttribute("x", 0); lbl.setAttribute("y", y-3);
    lbl.setAttribute("font-size","8.5"); lbl.setAttribute("fill",mutedColor);
    lbl.textContent = fmtPct(v)+"%";
    svg.appendChild(lbl);
    const lblR = document.createElementNS(svgNS,"text");
    lblR.setAttribute("x", W); lblR.setAttribute("y", y-3);
    lblR.setAttribute("text-anchor","end");
    lblR.setAttribute("font-size","8.5"); lblR.setAttribute("fill",mutedColor);
    lblR.textContent = fmtPct(100-v)+"%";
    svg.appendChild(lblR);
  });
  if(50 >= minV && 50 <= maxV){
    const y50 = yFor(50);
    const line50 = document.createElementNS(svgNS,"line");
    line50.setAttribute("x1",padL); line50.setAttribute("x2",W-padR);
    line50.setAttribute("y1",y50); line50.setAttribute("y2",y50);
    line50.setAttribute("stroke",baseColor); line50.setAttribute("stroke-width","1");
    line50.setAttribute("stroke-dasharray","3,3");
    svg.appendChild(line50);
  }

  function drawSeries(key, color){
    const pts = data.map((d,i)=>[xFor(i), yFor(d[key])]);
    const pathD = pts.map((p,i)=> (i===0?"M":"L")+p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
    const path = document.createElementNS(svgNS,"path");
    path.setAttribute("d", pathD);
    path.setAttribute("fill","none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width","2");
    path.setAttribute("stroke-linecap","round");
    path.setAttribute("stroke-linejoin","round");
    svg.appendChild(path);
    pts.forEach(p=>{
      const c = document.createElementNS(svgNS,"circle");
      c.setAttribute("cx",p[0]); c.setAttribute("cy",p[1]); c.setAttribute("r","3.5");
      c.setAttribute("fill", color);
      svg.appendChild(c);
    });
    return pts;
  }
  const monthlyPts = drawSeries('monthly', s1Color);
  const cumulativePts = drawSeries('cumulative', s2Color);

  data.forEach((d,i)=>{
    const lbl = document.createElementNS(svgNS,"text");
    lbl.setAttribute("x",xFor(i)); lbl.setAttribute("y",H-6);
    lbl.setAttribute("text-anchor", i===0?"start":(i===data.length-1?"end":"middle"));
    lbl.setAttribute("font-size","9.5");
    lbl.setAttribute("fill",mutedColor);
    lbl.textContent = new Date(d.mk+"-01T00:00:00").toLocaleDateString('fr-FR',{month:'short'});
    svg.appendChild(lbl);
  });

  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  wrap.appendChild(tooltip);

  const crosshair = document.createElementNS(svgNS,"line");
  crosshair.setAttribute("y1",padT); crosshair.setAttribute("y2",H-padB);
  crosshair.setAttribute("stroke",mutedColor); crosshair.setAttribute("stroke-width","1");
  crosshair.setAttribute("stroke-dasharray","2,2");
  crosshair.style.display = "none";
  svg.appendChild(crosshair);

  data.forEach((d,i)=>{
    const rect = document.createElementNS(svgNS,"rect");
    rect.setAttribute("x", xFor(i)-stepX/2);
    rect.setAttribute("y", 0);
    rect.setAttribute("width", stepX);
    rect.setAttribute("height", H);
    rect.setAttribute("fill","transparent");
    rect.style.cursor = "pointer";
    rect.addEventListener("mouseenter", ()=>showTip(i));
    rect.addEventListener("touchstart", ()=>{showTip(i);}, {passive:true});
    rect.addEventListener("mouseleave", hideTip);
    svg.appendChild(rect);
  });

  function showTip(i){
    crosshair.style.display = "block";
    crosshair.setAttribute("x1", monthlyPts[i][0]); crosshair.setAttribute("x2", monthlyPts[i][0]);
    const rectBox = svg.getBoundingClientRect();
    const midY = (monthlyPts[i][1] + cumulativePts[i][1]) / 2;
    const relX = (monthlyPts[i][0]/W) * rectBox.width;
    tooltip.style.left = relX + "px";
    tooltip.style.top = (midY/H)*rectBox.height + "px";
    tooltip.textContent = `${fmtMonthLabel(data[i].mk)} · mois ${store.memberAName} ${fmtPct(data[i].monthly)}% / ${store.memberBName} ${fmtPct(100-data[i].monthly)}% · cumulé ${store.memberAName} ${fmtPct(data[i].cumulative)}% / ${store.memberBName} ${fmtPct(100-data[i].cumulative)}%`;
    tooltip.classList.add("show");
  }
  function hideTip(){ crosshair.style.display="none"; tooltip.classList.remove("show"); }

  wrap.appendChild(svg);
}

function renderPaidBars(){
  const months = trailingMonths(6);
  const legend = document.getElementById("paidLegend");
  legend.innerHTML = `
    <div class="legend-item"><span class="legend-dot" style="background:var(--s1);"></span>${store.memberAName}</div>
    <div class="legend-item"><span class="legend-dot" style="background:var(--s2);"></span>${store.memberBName}</div>
  `;
  const perMonth = months.map(mk=>{
    const exps = store.expenses.filter(e=>calc.monthKey(e.date)===mk);
    const a = exps.filter(e=>e.paid_by==="a").reduce((s,e)=>s+e.amount,0);
    const b = exps.filter(e=>e.paid_by==="b").reduce((s,e)=>s+e.amount,0);
    return {mk, a, b};
  });
  const maxV = Math.max(...perMonth.map(d=>Math.max(d.a,d.b)), 1);
  const wrap = document.getElementById("paidBars");
  wrap.innerHTML = "";
  perMonth.forEach(d=>{
    const col = document.createElement("div");
    col.className = "gb-col";
    const hA = Math.max(2, (d.a/maxV)*118);
    const hB = Math.max(2, (d.b/maxV)*118);
    col.innerHTML = `
      <div class="gb-bars">
        <div class="gb-bar" style="height:${hA}px;background:var(--s1);" title="${store.memberAName} : ${fmtMoney(d.a)}"></div>
        <div class="gb-bar" style="height:${hB}px;background:var(--s2);" title="${store.memberBName} : ${fmtMoney(d.b)}"></div>
      </div>
      <div class="gb-label">${new Date(d.mk+"-01T00:00:00").toLocaleDateString('fr-FR',{month:'short'})}</div>
    `;
    wrap.appendChild(col);
  });
}

function renderNames(){
  document.getElementById("nameA").value = store.memberAName;
  document.getElementById("nameB").value = store.memberBName;
  document.querySelectorAll('#fPaidBy button[data-val="a"]').forEach(b=>b.textContent=store.memberAName);
  document.querySelectorAll('#fPaidBy button[data-val="b"]').forEach(b=>b.textContent=store.memberBName);
  document.querySelectorAll('#fIncPerson button[data-val="a"]').forEach(b=>b.textContent=store.memberAName);
  document.querySelectorAll('#fIncPerson button[data-val="b"]').forEach(b=>b.textContent=store.memberBName);
  document.querySelectorAll('#fSettleDebtor button[data-val="a"]').forEach(b=>b.textContent=store.memberAName);
  document.querySelectorAll('#fSettleDebtor button[data-val="b"]').forEach(b=>b.textContent=store.memberBName);
  document.querySelectorAll('#recPaidBy button[data-val="a"]').forEach(b=>b.textContent=store.memberAName);
  document.querySelectorAll('#recPaidBy button[data-val="b"]').forEach(b=>b.textContent=store.memberBName);
}

function renderSplitModeList(){
  const el = document.getElementById('splitModeList');
  if(!el) return;
  el.innerHTML = "";
  SPLIT_MODES.forEach(m=>{
    const opt = document.createElement('button');
    opt.type = "button";
    opt.className = 'mode-option' + (store.splitMode===m.id ? ' selected':'');
    opt.innerHTML = `<div class="mo-radio"></div><div><div class="mo-title">${m.title}</div><div class="mo-desc">${m.desc}</div></div>`;
    opt.addEventListener('click', async ()=>{
      if(store.splitMode === m.id) return;
      await setSplitMode(m.id);
    });
    el.appendChild(opt);
  });
}

function renderRecurringList(){
  const el = document.getElementById('recurringList');
  if(!el) return;
  el.innerHTML = "";
  if(!store.recurring.length){
    el.innerHTML = '<div class="empty">Aucune dépense récurrente pour l\'instant.</div>';
    return;
  }
  store.recurring.forEach(tpl=>{
    const cat = catOf(tpl.category_id);
    if(!cat) return;
    const row = document.createElement('div');
    row.className = 'recurring-row' + (tpl.active ? '' : ' paused');
    row.innerHTML = `
      <div class="rec-icon" style="background:color-mix(in srgb, var(${cat.color}) 18%, transparent);">${cat.icon}</div>
      <div class="rec-info">
        <div class="rec-desc">${tpl.description}</div>
        <div class="rec-meta">${cat.label} · le ${tpl.day_of_month} · payé par ${nameOf(tpl.paid_by)}${tpl.active ? '' : ' · en pause'}</div>
      </div>
      <div class="rec-amount">${fmtMoney(tpl.amount)}</div>
      <label class="switch" onclick="event.stopPropagation();"><input type="checkbox" ${tpl.active?'checked':''}><span class="slider-tg"></span></label>
    `;
    row.addEventListener('click', ()=>openRecurringModal(tpl.id));
    row.querySelector('input[type=checkbox]').addEventListener('change', async (e)=>{
      await setRecurringActive(tpl.id, e.target.checked);
      showToast(e.target.checked ? "Récurrence réactivée ✓" : "Récurrence mise en pause");
    });
    el.appendChild(row);
  });
}

function renderCategoryList(){
  const el = document.getElementById('categoryList');
  if(!el) return;
  el.innerHTML = "";
  store.categories.forEach(c=>{
    const n = store.expenses.filter(e=>e.category_id===c.id).length + store.recurring.filter(r=>r.category_id===c.id).length;
    const row = document.createElement('div');
    row.className = 'recurring-row';
    row.innerHTML = `
      <div class="rec-icon" style="background:color-mix(in srgb, var(${c.color}) 18%, transparent);">${c.icon}</div>
      <div class="rec-info">
        <div class="rec-desc">${c.label}</div>
        <div class="rec-meta">${n} dépense${n>1?'s':''} liée${n>1?'s':''}</div>
      </div>
    `;
    row.addEventListener('click', ()=>openCategoryModal(c.id));
    el.appendChild(row);
  });
}

function renderAll(){
  renderNames();
  renderHome();
  renderHistory();
  renderStats();
  renderSplitModeList();
  renderRecurringList();
  renderCategoryList();
  document.getElementById('inviteCodeDisplay').textContent = inviteCodeCache || '…';
}

/* ============================================================================
   NAVIGATION
   ============================================================================ */
document.querySelectorAll('[data-nav]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const target = btn.getAttribute('data-nav');
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById('screen-'+target).classList.add('active');
    document.querySelectorAll('.navbtn').forEach(n=>n.classList.remove('active'));
    const navBtn = document.querySelector('.navbtn[data-nav="'+target+'"]');
    if(navBtn) navBtn.classList.add('active');
    window.scrollTo(0,0);
    if(target === 'stats') renderStats();
  });
});

/* ============================================================================
   THÈME (préférence locale à l'appareil, non synchronisée)
   ============================================================================ */
let dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
function applyTheme(){
  document.documentElement.setAttribute('data-theme', dark ? 'dark':'light');
  document.getElementById('darkSwitch').checked = dark;
}
document.getElementById('themeToggle').addEventListener('click', ()=>{
  dark = !dark; applyTheme(); renderStats();
});
document.getElementById('darkSwitch').addEventListener('change', (e)=>{
  dark = e.target.checked; applyTheme(); renderStats();
});

/* ============================================================================
   MARQUER COMME RÉGLÉ
   ============================================================================ */
document.getElementById('settleBtn').addEventListener('click', async ()=>{
  const net = calc.currentTotalBalance(calcData());
  if(Math.round(Math.abs(net)*100)===0) return;
  const debtorRole = net>0 ? "b" : "a";
  const creditorRole = net>0 ? "a" : "b";
  await addSettlement({
    date: todayStr(), amount: Math.abs(net), debtor: debtorRole, creditor: creditorRole,
    note: `${nameOf(debtorRole)} → ${nameOf(creditorRole)}`,
  });
  showToast("Solde marqué comme réglé ✓");
});

/* ============================================================================
   RÉGLAGES : prénoms
   ============================================================================ */
document.getElementById('nameA').addEventListener('change', async e=>{
  await setNames(e.target.value || store.memberAName, store.memberBName);
});
document.getElementById('nameB').addEventListener('change', async e=>{
  await setNames(store.memberAName, e.target.value || store.memberBName);
});
document.getElementById('signOutBtn').addEventListener('click', async ()=>{
  await auth.signOut();
  window.location.reload();
});

/* ============================================================================
   CATÉGORIES : grille de choix réutilisable
   ============================================================================ */
function buildCatChips(container, getSelected, onSelect){
  container.innerHTML = "";
  store.categories.forEach(c=>{
    const chip = document.createElement('div');
    chip.className = 'catchip' + (c.id===getSelected()?' selected':'');
    chip.dataset.cat = c.id;
    chip.innerHTML = `<div class="ic" style="background:color-mix(in srgb, var(${c.color}) 20%, transparent);">${c.icon}</div><span class="lb">${c.label}</span>`;
    chip.addEventListener('click', ()=>onSelect(c.id));
    container.appendChild(chip);
  });
}
function ensureValidCatSelections(){
  if(!store.categories.some(c=>c.id===selectedCat)) selectedCat = store.categories[0]?.id;
  if(!store.categories.some(c=>c.id===selectedRecCat)) selectedRecCat = store.categories[0]?.id;
}

/* ============================================================================
   MODAL AJOUT/ÉDITION (dépense / revenu / versement)
   ============================================================================ */
const modalBackdrop = document.getElementById('modalBackdrop');
const fCatGrid = document.getElementById('fCatGrid');
let selectedCat = null;
function selectCatChip(catId){
  selectedCat = catId;
  fCatGrid.querySelectorAll('.catchip').forEach(x=>x.classList.toggle('selected', x.dataset.cat===catId));
}
function rebuildFCatGrid(){ buildCatChips(fCatGrid, ()=>selectedCat, selectCatChip); }

const fIncSourceGrid = document.getElementById('fIncSourceGrid');
let selectedSource = INCOME_SOURCES[0].id;
function selectSourceChip(srcId){
  selectedSource = srcId;
  fIncSourceGrid.querySelectorAll('.catchip').forEach(x=>x.classList.toggle('selected', x.dataset.src===srcId));
}
INCOME_SOURCES.forEach(s=>{
  const chip = document.createElement('div');
  chip.className = 'catchip' + (s.id===selectedSource?' selected':'');
  chip.dataset.src = s.id;
  chip.innerHTML = `<div class="ic" style="background:color-mix(in srgb, var(${s.color}) 20%, transparent);">${s.icon}</div><span class="lb">${s.label}</span>`;
  chip.addEventListener('click', ()=>selectSourceChip(s.id));
  fIncSourceGrid.appendChild(chip);
});

let selectedIncPerson = "a";
function setIncPerson(val){
  selectedIncPerson = val;
  document.querySelectorAll('#fIncPerson button').forEach(x=>x.classList.toggle('active', x.dataset.val===val));
}
document.querySelectorAll('#fIncPerson button').forEach(b=>{ b.addEventListener('click', ()=>setIncPerson(b.dataset.val)); });

let selectedEntryType = "expense";
const expenseFieldsEl = document.getElementById('expenseFields');
const incomeFieldsEl = document.getElementById('incomeFields');
const settlementFieldsEl = document.getElementById('settlementFields');
const modalTitleEl = document.getElementById('modalTitle');
const submitBtnEl = document.getElementById('submitExpense');
const fDescLabelEl = document.getElementById('fDescLabel');
const ENTRY_TYPE_META = {
  expense:    {title:"Nouvelle dépense", submit:"Ajouter la dépense", descLabel:"Description", descPlaceholder:"Ex : Courses Carrefour"},
  income:     {title:"Nouveau revenu", submit:"Ajouter le revenu", descLabel:"Description", descPlaceholder:"Ex : Salaire du mois"},
  settlement: {title:"Nouveau versement", submit:"Ajouter le versement", descLabel:"Note (optionnel)", descPlaceholder:"Ex : Remboursement en espèces"},
};
const EDIT_TYPE_META = {
  expense:    {title:"Modifier la dépense", submit:"Enregistrer les modifications", descLabel:"Description", descPlaceholder:"Ex : Courses Carrefour"},
  income:     {title:"Modifier le revenu", submit:"Enregistrer les modifications", descLabel:"Description", descPlaceholder:"Ex : Salaire du mois"},
  settlement: {title:"Modifier le versement", submit:"Enregistrer les modifications", descLabel:"Note (optionnel)", descPlaceholder:"Ex : Remboursement en espèces"},
};
let editingEntry = null;
function applyEntryTypeUI(){
  const meta = (editingEntry ? EDIT_TYPE_META : ENTRY_TYPE_META)[selectedEntryType];
  expenseFieldsEl.style.display = selectedEntryType==="expense" ? "block":"none";
  incomeFieldsEl.style.display = selectedEntryType==="income" ? "block":"none";
  settlementFieldsEl.style.display = selectedEntryType==="settlement" ? "block":"none";
  modalTitleEl.textContent = meta.title;
  submitBtnEl.textContent = meta.submit;
  fDescLabelEl.textContent = meta.descLabel;
  document.getElementById('fDesc').placeholder = meta.descPlaceholder;
  if(selectedEntryType === "settlement") updateSettleHint();
}
document.querySelectorAll('#fEntryType button').forEach(b=>{
  b.addEventListener('click', ()=>{
    document.querySelectorAll('#fEntryType button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    selectedEntryType = b.dataset.val;
    applyEntryTypeUI();
  });
});

let selectedSettleDebtor = "a";
function setSettleDebtor(val){
  selectedSettleDebtor = val;
  document.querySelectorAll('#fSettleDebtor button').forEach(x=>x.classList.toggle('active', x.dataset.val===val));
  updateSettleHint();
}
document.querySelectorAll('#fSettleDebtor button').forEach(b=>{ b.addEventListener('click', ()=>setSettleDebtor(b.dataset.val)); });

function updateSettleHint(){
  const box = document.getElementById('settleHint');
  if(!box) return;
  const net = calc.currentTotalBalance(calcData());
  const debtor = selectedSettleDebtor;
  if(Math.round(Math.abs(net)*100)===0){
    box.innerHTML = `<div class="small muted">Aucun solde en cours entre vous deux pour l'instant.</div>`;
    return;
  }
  const actualDebtor = net>0 ? "b" : "a";
  const amountOwed = Math.abs(net);
  let note = `<div class="small muted">Solde actuel : ${nameOf(actualDebtor)} doit ${fmtMoney(amountOwed)} à ${nameOf(actualDebtor==="a"?"b":"a")}.</div>`;
  if(debtor !== actualDebtor){
    note += `<div class="small muted" style="margin-top:4px;">⚠️ Tu as sélectionné ${nameOf(debtor)} comme payeur, mais c'est plutôt ${nameOf(actualDebtor)} qui doit de l'argent d'après le solde actuel.</div>`;
  }
  box.innerHTML = note;
}

let selectedPaidBy = "a";
function setPaidBy(val){
  selectedPaidBy = val;
  document.querySelectorAll('#fPaidBy button').forEach(x=>x.classList.toggle('active', x.dataset.val===val));
  updateSplitPreview();
}
document.querySelectorAll('#fPaidBy button').forEach(b=>{ b.addEventListener('click', ()=>setPaidBy(b.dataset.val)); });

function currentAmount(){ return parseFloat(document.getElementById('fAmount').value) || 0; }

function updateSplitPreview(){
  const amount = currentAmount();
  const dateVal = document.getElementById('fDate').value || todayStr();
  const box = document.getElementById('modeSplitPreview');
  if(!box) return;

  if(store.splitMode === "5050"){
    box.innerHTML = `
      <div class="split-row"><span>${store.memberAName} — 50%</span><span>${fmtMoney(amount*0.5)}</span></div>
      <div class="split-row"><span>${store.memberBName} — 50%</span><span>${fmtMoney(amount*0.5)}</span></div>
      <div class="small muted" style="margin-top:4px;">Mode « 50 / 50 » · modifiable dans Réglages.</div>
    `;
    return;
  }
  if(store.splitMode === "monthly"){
    const mk = calc.monthKey(dateVal);
    const inc = calc.incomesFor(store.incomeEntries, mk);
    if((inc.a+inc.b)<=0){
      box.innerHTML = `<div class="warn-note">Aucun revenu enregistré pour ${fmtMonthLabel(mk)} — 50/50 sera utilisé par défaut pour cette dépense. Ajoute vos revenus avec le bouton + (type « Revenu »).</div>`;
      return;
    }
    const ratio = calc.monthIncomeRatio(store.incomeEntries, mk);
    box.innerHTML = `
      <div class="split-row"><span>${store.memberAName} — ${fmtPct(ratio.a*100)}%</span><span>${fmtMoney(amount*ratio.a)}</span></div>
      <div class="split-row"><span>${store.memberBName} — ${fmtPct(ratio.b*100)}%</span><span>${fmtMoney(amount*ratio.b)}</span></div>
      <div class="small muted" style="margin-top:4px;">Mode « Prorata mois par mois » · revenus de ${fmtMonthLabel(mk)} · modifiable dans Réglages.</div>
    `;
    return;
  }
  const cumMk = calc.monthKey(dateVal);
  const inc = calc.cumulativeIncomesThrough(store.incomeEntries, cumMk);
  if((inc.a+inc.b)<=0){
    box.innerHTML = `<div class="warn-note">Aucun revenu enregistré jusqu'à ${fmtMonthLabel(cumMk)} — 50/50 sera utilisé par défaut. Ajoute vos revenus avec le bouton + (type « Revenu »).</div>`;
    return;
  }
  const ratio = calc.cumulativeIncomeRatioThrough(store.incomeEntries, cumMk);
  box.innerHTML = `
    <div class="split-row"><span>${store.memberAName} — ${fmtPct(ratio.a*100)}%</span><span>${fmtMoney(amount*ratio.a)}</span></div>
    <div class="split-row"><span>${store.memberBName} — ${fmtPct(ratio.b*100)}%</span><span>${fmtMoney(amount*ratio.b)}</span></div>
    <div class="small muted" style="margin-top:4px;">Mode « Prorata cumulé » · cumul jusqu'à ${fmtMonthLabel(cumMk)} (${fmtMoney(inc.a)} / ${fmtMoney(inc.b)}) · modifiable dans Réglages.</div>
  `;
}
document.getElementById('fAmount').addEventListener('input', updateSplitPreview);
document.getElementById('fDate').addEventListener('change', updateSplitPreview);

function openModal(){
  editingEntry = null;
  document.getElementById('fEntryType').style.display = "flex";
  document.getElementById('deleteEntryBtn').style.display = "none";

  document.getElementById('fAmount').value = "";
  document.getElementById('fDesc').value = "";
  document.getElementById('fDate').value = todayStr();

  selectedEntryType = "expense";
  document.querySelectorAll('#fEntryType button').forEach(x=>x.classList.toggle('active', x.dataset.val==="expense"));
  applyEntryTypeUI();

  ensureValidCatSelections();
  rebuildFCatGrid();
  setPaidBy("a");
  setIncPerson("a");
  setSettleDebtor("a");

  updateSplitPreview();
  modalBackdrop.classList.add('active');
}

function openEditModal(type, id){
  let entry;
  if(type === "expense") entry = store.expenses.find(e=>e.id===id);
  else if(type === "income") entry = store.incomeEntries.find(e=>e.id===id);
  else entry = store.settlements.find(s=>s.id===id);
  if(!entry) return;

  editingEntry = {type, id};
  selectedEntryType = type;
  document.getElementById('fEntryType').style.display = "none";
  document.getElementById('deleteEntryBtn').style.display = "block";

  document.getElementById('fAmount').value = entry.amount;
  document.getElementById('fDesc').value = type === "settlement" ? (entry.note || "") : (entry.description || "");
  document.getElementById('fDate').value = entry.date;

  if(type === "expense"){
    rebuildFCatGrid();
    selectCatChip(entry.category_id);
    setPaidBy(entry.paid_by);
  } else if(type === "income"){
    selectSourceChip(entry.source);
    setIncPerson(entry.person);
  } else {
    setSettleDebtor(entry.debtor);
  }

  applyEntryTypeUI();
  updateSplitPreview();
  modalBackdrop.classList.add('active');
}

function closeModal(){ modalBackdrop.classList.remove('active'); }
document.getElementById('fabAdd').addEventListener('click', openModal);
document.getElementById('cancelExpense').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e)=>{ if(e.target===modalBackdrop) closeModal(); });

/* ============================================================================
   BOÎTE DE CONFIRMATION GÉNÉRIQUE (suppression / modification)
   ============================================================================ */
const confirmBackdrop = document.getElementById('confirmBackdrop');
function confirmAction({title, message, okLabel, danger}){
  return new Promise(resolve=>{
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = message;
    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    okBtn.textContent = okLabel || "Confirmer";
    okBtn.classList.toggle('danger', !!danger);
    function cleanup(result){
      confirmBackdrop.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      confirmBackdrop.removeEventListener('click', onBackdrop);
      resolve(result);
    }
    function onOk(){ cleanup(true); }
    function onCancel(){ cleanup(false); }
    function onBackdrop(e){ if(e.target===confirmBackdrop) cleanup(false); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    confirmBackdrop.addEventListener('click', onBackdrop);
    confirmBackdrop.classList.add('active');
  });
}

document.getElementById('submitExpense').addEventListener('click', async ()=>{
  const amount = currentAmount();
  const desc = document.getElementById('fDesc').value.trim();
  const date = document.getElementById('fDate').value || todayStr();
  if(amount<=0){ showToast("Indique un montant valide"); return; }
  if(selectedEntryType !== "settlement" && !desc){ showToast("Ajoute une description"); return; }

  if(editingEntry){
    const typeLabel = editingEntry.type==="expense" ? "cette dépense" : editingEntry.type==="income" ? "ce revenu" : "ce versement";
    const ok = await confirmAction({ title: "Enregistrer les modifications ?", message: `Confirmer la modification de ${typeLabel} ?`, okLabel: "Modifier" });
    if(!ok) return;
    try{
      if(editingEntry.type === "expense"){
        await updateExpense(editingEntry.id, {date, categoryId: selectedCat, description: desc, amount, paidBy: selectedPaidBy});
        showToast("Dépense modifiée ✓");
      } else if(editingEntry.type === "income"){
        await updateIncome(editingEntry.id, {date, source: selectedSource, description: desc, amount, person: selectedIncPerson});
        showToast("Revenu modifié ✓");
      } else {
        const debtor = selectedSettleDebtor;
        const creditor = debtor === "a" ? "b" : "a";
        const note = desc || `${nameOf(debtor)} → ${nameOf(creditor)}`;
        await updateSettlement(editingEntry.id, {date, amount, debtor, creditor, note});
        showToast("Versement modifié ✓");
      }
      closeModal();
    } catch(err){ showToast("Erreur : " + err.message); }
    return;
  }

  try{
    if(selectedEntryType === "expense"){
      await addExpense({date, categoryId: selectedCat, description: desc, amount, paidBy: selectedPaidBy});
      showToast("Dépense ajoutée ✓");
    } else if(selectedEntryType === "income"){
      await addIncome({date, source: selectedSource, description: desc, amount, person: selectedIncPerson});
      showToast("Revenu ajouté ✓");
    } else {
      const debtor = selectedSettleDebtor;
      const creditor = debtor === "a" ? "b" : "a";
      const note = desc || `${nameOf(debtor)} → ${nameOf(creditor)}`;
      await addSettlement({date, amount, debtor, creditor, note});
      showToast("Versement ajouté ✓");
    }
    closeModal();
  } catch(err){ showToast("Erreur : " + err.message); }
});

document.getElementById('deleteEntryBtn').addEventListener('click', async ()=>{
  if(!editingEntry) return;
  const typeLabel = editingEntry.type==="expense" ? "cette dépense" : editingEntry.type==="income" ? "ce revenu" : "ce versement";
  const ok = await confirmAction({ title: "Supprimer ?", message: `Es-tu sûr de vouloir supprimer ${typeLabel} ? Cette action est irréversible.`, okLabel: "Supprimer", danger: true });
  if(!ok) return;
  try{
    if(editingEntry.type === "expense"){ await deleteExpense(editingEntry.id); showToast("Dépense supprimée"); }
    else if(editingEntry.type === "income"){ await deleteIncome(editingEntry.id); showToast("Revenu supprimé"); }
    else { await deleteSettlement(editingEntry.id); showToast("Versement supprimé"); }
    closeModal();
  } catch(err){ showToast("Erreur : " + err.message); }
});

/* ============================================================================
   MODAL RÉCURRENCE
   ============================================================================ */
const recurringModalBackdrop = document.getElementById('recurringModalBackdrop');
const recCatGrid = document.getElementById('recCatGrid');
let selectedRecCat = null;
function selectRecCatChip(catId){
  selectedRecCat = catId;
  recCatGrid.querySelectorAll('.catchip').forEach(x=>x.classList.toggle('selected', x.dataset.cat===catId));
}
function rebuildRecCatGrid(){ buildCatChips(recCatGrid, ()=>selectedRecCat, selectRecCatChip); }

let selectedRecPaidBy = "a";
function setRecPaidBy(val){
  selectedRecPaidBy = val;
  document.querySelectorAll('#recPaidBy button').forEach(x=>x.classList.toggle('active', x.dataset.val===val));
}
document.querySelectorAll('#recPaidBy button').forEach(b=>{ b.addEventListener('click', ()=>setRecPaidBy(b.dataset.val)); });

let editingRecurring = null;
function openRecurringModal(id){
  editingRecurring = id || null;
  const tpl = id ? store.recurring.find(r=>r.id===id) : null;
  document.getElementById('recurringModalTitle').textContent = tpl ? "Modifier la récurrence" : "Nouvelle récurrence";
  document.getElementById('submitRecurring').textContent = tpl ? "Enregistrer les modifications" : "Ajouter la récurrence";
  document.getElementById('deleteRecurringBtn').style.display = tpl ? "block" : "none";
  document.getElementById('recAmount').value = tpl ? tpl.amount : "";
  document.getElementById('recDesc').value = tpl ? tpl.description : "";
  document.getElementById('recDay').value = tpl ? tpl.day_of_month : 1;
  document.getElementById('recActive').checked = tpl ? tpl.active : true;
  ensureValidCatSelections();
  rebuildRecCatGrid();
  selectRecCatChip(tpl ? tpl.category_id : store.categories[0]?.id);
  setRecPaidBy(tpl ? tpl.paid_by : "a");
  recurringModalBackdrop.classList.add('active');
}
function closeRecurringModal(){ recurringModalBackdrop.classList.remove('active'); }
document.getElementById('addRecurringBtn').addEventListener('click', ()=>openRecurringModal(null));
document.getElementById('cancelRecurring').addEventListener('click', closeRecurringModal);
recurringModalBackdrop.addEventListener('click', (e)=>{ if(e.target===recurringModalBackdrop) closeRecurringModal(); });

document.getElementById('submitRecurring').addEventListener('click', async ()=>{
  const amount = parseFloat(document.getElementById('recAmount').value) || 0;
  const desc = document.getElementById('recDesc').value.trim();
  const day = Math.min(28, Math.max(1, parseInt(document.getElementById('recDay').value,10) || 1));
  const active = document.getElementById('recActive').checked;
  if(amount<=0){ showToast("Indique un montant valide"); return; }
  if(!desc){ showToast("Ajoute une description"); return; }

  try{
    if(editingRecurring){
      const ok = await confirmAction({ title: "Enregistrer les modifications ?", message: "Confirmer la modification de cette dépense récurrente ? Seules les prochaines occurrences seront concernées.", okLabel: "Modifier" });
      if(!ok) return;
      await updateRecurring(editingRecurring, {description: desc, categoryId: selectedRecCat, amount, paidBy: selectedRecPaidBy, dayOfMonth: day, active});
      showToast("Récurrence modifiée ✓");
    } else {
      await addRecurring({description: desc, categoryId: selectedRecCat, amount, paidBy: selectedRecPaidBy, dayOfMonth: day, active});
      showToast("Récurrence ajoutée ✓");
    }
    closeRecurringModal();
  } catch(err){ showToast("Erreur : " + err.message); }
});

document.getElementById('deleteRecurringBtn').addEventListener('click', async ()=>{
  if(!editingRecurring) return;
  const ok = await confirmAction({ title: "Supprimer cette récurrence ?", message: "Les prochaines générations s'arrêteront. Les dépenses déjà générées restent dans l'historique.", okLabel: "Supprimer", danger: true });
  if(!ok) return;
  try{
    await deleteRecurring(editingRecurring);
    closeRecurringModal();
    showToast("Récurrence supprimée");
  } catch(err){ showToast("Erreur : " + err.message); }
});

/* ============================================================================
   CATÉGORIES (gestion)
   ============================================================================ */
const catIconGrid = document.getElementById('catIconGrid');
let selectedCatIcon = CATEGORY_ICONS[0];
function selectCatIcon(icon){
  selectedCatIcon = icon;
  catIconGrid.querySelectorAll('.icon-chip').forEach(x=>x.classList.toggle('selected', x.dataset.icon===icon));
}
CATEGORY_ICONS.forEach(icon=>{
  const chip = document.createElement('div');
  chip.className = 'icon-chip';
  chip.dataset.icon = icon;
  chip.textContent = icon;
  chip.addEventListener('click', ()=>selectCatIcon(icon));
  catIconGrid.appendChild(chip);
});

const categoryModalBackdrop = document.getElementById('categoryModalBackdrop');
let editingCategory = null;
function openCategoryModal(id){
  editingCategory = id || null;
  const cat = id ? catOf(id) : null;
  document.getElementById('categoryModalTitle').textContent = cat ? "Modifier la catégorie" : "Nouvelle catégorie";
  document.getElementById('submitCategory').textContent = cat ? "Enregistrer les modifications" : "Ajouter la catégorie";
  document.getElementById('deleteCategoryBtn').style.display = cat ? "block" : "none";
  document.getElementById('catLabelInput').value = cat ? cat.label : "";
  selectCatIcon(cat ? cat.icon : CATEGORY_ICONS[0]);
  categoryModalBackdrop.classList.add('active');
}
function closeCategoryModal(){ categoryModalBackdrop.classList.remove('active'); }
document.getElementById('addCategoryBtn').addEventListener('click', ()=>openCategoryModal(null));
document.getElementById('cancelCategory').addEventListener('click', closeCategoryModal);
categoryModalBackdrop.addEventListener('click', (e)=>{ if(e.target===categoryModalBackdrop) closeCategoryModal(); });

document.getElementById('submitCategory').addEventListener('click', async ()=>{
  const icon = selectedCatIcon;
  const label = document.getElementById('catLabelInput').value.trim();
  if(!label){ showToast("Donne un nom à la catégorie"); return; }

  try{
    if(editingCategory){
      const ok = await confirmAction({ title: "Enregistrer les modifications ?", message: `Confirmer la modification de la catégorie « ${catOf(editingCategory).label} » ?`, okLabel: "Modifier" });
      if(!ok) return;
      await updateCategory(editingCategory, {label, icon});
      showToast("Catégorie modifiée ✓");
    } else {
      await addCategory({label, icon});
      showToast("Catégorie ajoutée ✓");
    }
    closeCategoryModal();
    rebuildFCatGrid(); rebuildRecCatGrid();
  } catch(err){ showToast("Erreur : " + err.message); }
});

const reassignBackdrop = document.getElementById('reassignBackdrop');
function askReassignThenDelete(catId, nExp, nRec){
  return new Promise(resolve=>{
    const cat = catOf(catId);
    const parts = [];
    if(nExp) parts.push(`${nExp} dépense${nExp>1?'s':''}`);
    if(nRec) parts.push(`${nRec} récurrence${nRec>1?'s':''}`);
    document.getElementById('reassignMsg').textContent =
      `« ${cat.label} » est encore utilisée par ${parts.join(' et ')}. Choisis une catégorie de destination avant de la supprimer.`;
    const select = document.getElementById('reassignSelect');
    select.innerHTML = "";
    store.categories.filter(c=>c.id!==catId).forEach(c=>{
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = `${c.icon} ${c.label}`;
      select.appendChild(opt);
    });
    const okBtn = document.getElementById('reassignOkBtn');
    const cancelBtn = document.getElementById('reassignCancelBtn');
    function cleanup(result){
      reassignBackdrop.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      reassignBackdrop.removeEventListener('click', onBackdrop);
      resolve(result);
    }
    function onOk(){ cleanup(select.value); }
    function onCancel(){ cleanup(null); }
    function onBackdrop(e){ if(e.target===reassignBackdrop) cleanup(null); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    reassignBackdrop.addEventListener('click', onBackdrop);
    reassignBackdrop.classList.add('active');
  });
}

document.getElementById('deleteCategoryBtn').addEventListener('click', async ()=>{
  if(!editingCategory) return;
  if(store.categories.length <= 1){ showToast("Il doit rester au moins une catégorie"); return; }

  const nExp = store.expenses.filter(e=>e.category_id===editingCategory).length;
  const nRec = store.recurring.filter(r=>r.category_id===editingCategory).length;

  try{
    if(nExp>0 || nRec>0){
      const targetId = await askReassignThenDelete(editingCategory, nExp, nRec);
      if(!targetId) return;
      await reassignAndDeleteCategory(editingCategory, targetId);
    } else {
      const ok = await confirmAction({ title: "Supprimer cette catégorie ?", message: `Supprimer « ${catOf(editingCategory).label} » ? Cette action est irréversible.`, okLabel: "Supprimer", danger: true });
      if(!ok) return;
      await deleteCategory(editingCategory);
    }
    ensureValidCatSelections();
    closeCategoryModal();
    rebuildFCatGrid(); rebuildRecCatGrid();
    showToast("Catégorie supprimée");
  } catch(err){ showToast("Erreur : " + err.message); }
});

/* ============================================================================
   TOAST
   ============================================================================ */
let toastTimer;
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 1800);
}

/* ============================================================================
   PORTE D'ENTRÉE : auth + création/rejoint du couple
   ============================================================================ */
let inviteCodeCache = null;

function showAuthStep(step){
  document.getElementById('authStepSignin').style.display = step==='signin' ? 'block':'none';
  document.getElementById('authStepCheckEmail').style.display = step==='checkEmail' ? 'block':'none';
  document.getElementById('authStepOnboarding').style.display = step==='onboarding' ? 'block':'none';
}
function showAuthError(msg){
  const el = document.getElementById('authError');
  if(!msg){ el.style.display = 'none'; return; }
  el.textContent = msg;
  el.style.display = 'block';
}

document.getElementById('authSendLink').addEventListener('click', async ()=>{
  const email = document.getElementById('authEmail').value.trim();
  if(!email){ showAuthError("Indique ton email."); return; }
  try{
    showAuthError(null);
    await auth.signInWithEmail(email);
    document.getElementById('authSentTo').textContent = email;
    showAuthStep('checkEmail');
  } catch(err){ showAuthError(err.message); }
});
document.getElementById('authBackToSignin').addEventListener('click', ()=>showAuthStep('signin'));

document.getElementById('obChooseCreate').addEventListener('click', ()=>{
  document.querySelectorAll('.onboard-choice .mode-option').forEach(b=>b.classList.remove('selected'));
  document.getElementById('obChooseCreate').classList.add('selected');
  document.getElementById('obCreateFields').style.display = 'block';
  document.getElementById('obJoinFields').style.display = 'none';
});
document.getElementById('obChooseJoin').addEventListener('click', ()=>{
  document.querySelectorAll('.onboard-choice .mode-option').forEach(b=>b.classList.remove('selected'));
  document.getElementById('obChooseJoin').classList.add('selected');
  document.getElementById('obJoinFields').style.display = 'block';
  document.getElementById('obCreateFields').style.display = 'none';
});
document.getElementById('obCreateSubmit').addEventListener('click', async ()=>{
  const aName = document.getElementById('obNameA').value.trim() || 'Moi';
  const bName = document.getElementById('obNameB').value.trim() || 'Partenaire';
  try{
    showAuthError(null);
    const coupleId = await auth.createCouple(aName, bName);
    await startApp(coupleId, 'a');
  } catch(err){ showAuthError(err.message); }
});
document.getElementById('obJoinSubmit').addEventListener('click', async ()=>{
  const code = document.getElementById('obJoinCode').value.trim().toLowerCase();
  if(!code){ showAuthError("Indique le code d'invitation."); return; }
  try{
    showAuthError(null);
    const coupleId = await auth.joinCouple(code);
    await startApp(coupleId, 'b');
  } catch(err){ showAuthError(err.message); }
});

async function startApp(coupleId, role){
  await loadCouple(coupleId, role);
  inviteCodeCache = await auth.getInviteCode(coupleId);
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  applyTheme();
  onStoreChange(renderAll);
  renderAll();
}

async function boot(){
  try{
    const session = await auth.getSession();
    if(!session){ showAuthStep('signin'); return; }
    const membership = await auth.getMyCouple();
    if(membership){
      await startApp(membership.coupleId, membership.role);
    } else {
      showAuthStep('onboarding');
    }
  } catch(err){
    showAuthError(err.message);
    showAuthStep('signin');
  }
}

auth.onAuthChange((session)=>{
  // Se déclenche notamment après le clic sur le lien magique reçu par email.
  if(session && document.getElementById('app').style.display === 'none'){
    boot();
  }
});

boot();

/* ============================================================================
   PWA : enregistrement du service worker (coquille en cache, usage hors-ligne basique)
   ============================================================================ */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('/sw.js').catch(()=>{ /* pas bloquant si ça échoue */ });
  });
}
