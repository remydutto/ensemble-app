-- ============================================================================
-- Ensemble — schéma Supabase (Postgres)
-- À exécuter une fois dans l'éditeur SQL de ton projet Supabase (SQL Editor > New query).
-- ============================================================================

create extension if not exists "pgcrypto"; -- pour gen_random_uuid()

-- ----------------------------------------------------------------------------
-- couples : une ligne par couple. "a" et "b" reprennent les rôles Rémy/partenaire
-- du prototype, mais avec des noms modifiables plutôt que figés en dur.
-- ----------------------------------------------------------------------------
create table couples (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  member_a_name text not null default 'Rémy',
  member_b_name text not null default 'Partenaire',
  split_mode text not null default 'cumulative' check (split_mode in ('5050','monthly','cumulative')),
  invite_code text not null unique default substr(md5(random()::text), 1, 8)
);

-- ----------------------------------------------------------------------------
-- couple_members : associe un utilisateur Supabase Auth à un couple + un rôle (a/b).
-- Un couple a au maximum un membre "a" et un membre "b".
-- ----------------------------------------------------------------------------
create table couple_members (
  couple_id uuid not null references couples(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('a','b')),
  joined_at timestamptz not null default now(),
  primary key (couple_id, user_id),
  unique (couple_id, role)
);

-- ----------------------------------------------------------------------------
-- categories
-- ----------------------------------------------------------------------------
create table categories (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  label text not null,
  icon text not null default '🏷️',
  color text not null default '--s1', -- réutilise directement les tokens CSS --s1..--s8 du prototype
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- recurring_expenses : modèles de dépenses récurrentes (loyer, abonnements...)
-- ----------------------------------------------------------------------------
create table recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  category_id uuid not null references categories(id) on delete restrict,
  description text not null,
  amount numeric(10,2) not null check (amount > 0),
  paid_by text not null check (paid_by in ('a','b')),
  day_of_month int not null check (day_of_month between 1 and 28),
  active boolean not null default true,
  start_month date not null, -- toujours stocké au 1er du mois, ex. '2026-08-01'
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- expenses
-- ----------------------------------------------------------------------------
create table expenses (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  category_id uuid not null references categories(id) on delete restrict,
  date date not null,
  description text not null,
  amount numeric(10,2) not null check (amount > 0),
  paid_by text not null check (paid_by in ('a','b')),
  recurring_id uuid references recurring_expenses(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- income_entries
-- ----------------------------------------------------------------------------
create table income_entries (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  date date not null,
  source text not null,
  description text,
  amount numeric(10,2) not null check (amount > 0),
  person text not null check (person in ('a','b')),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- settlements (versements)
-- ----------------------------------------------------------------------------
create table settlements (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  date date not null,
  amount numeric(10,2) not null check (amount > 0),
  debtor text not null check (debtor in ('a','b')),
  creditor text not null check (creditor in ('a','b')),
  note text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security : chaque utilisateur ne voit / modifie que les données
-- du (ou des) couple(s) dont il est membre.
-- ============================================================================
alter table couples enable row level security;
alter table couple_members enable row level security;
alter table categories enable row level security;
alter table recurring_expenses enable row level security;
alter table expenses enable row level security;
alter table income_entries enable row level security;
alter table settlements enable row level security;

-- Petite fonction utilitaire : est-ce que l'utilisateur courant appartient à ce couple ?
create or replace function is_couple_member(target_couple_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from couple_members
    where couple_id = target_couple_id and user_id = auth.uid()
  );
$$;

-- couples : lisible/modifiable seulement par ses membres
create policy "couples_select" on couples for select
  using (is_couple_member(id));
create policy "couples_update" on couples for update
  using (is_couple_member(id));

-- couple_members : un membre voit les autres membres de son couple
create policy "couple_members_select" on couple_members for select
  using (is_couple_member(couple_id));

-- categories / recurring_expenses / expenses / income_entries / settlements :
-- CRUD complet, mais uniquement sur les lignes de son propre couple.
create policy "categories_all" on categories for all
  using (is_couple_member(couple_id)) with check (is_couple_member(couple_id));
create policy "recurring_all" on recurring_expenses for all
  using (is_couple_member(couple_id)) with check (is_couple_member(couple_id));
create policy "expenses_all" on expenses for all
  using (is_couple_member(couple_id)) with check (is_couple_member(couple_id));
create policy "income_all" on income_entries for all
  using (is_couple_member(couple_id)) with check (is_couple_member(couple_id));
create policy "settlements_all" on settlements for all
  using (is_couple_member(couple_id)) with check (is_couple_member(couple_id));

-- ============================================================================
-- Fonctions RPC : création d'un couple, et rejoindre un couple via code d'invitation.
-- (security definer car il faut pouvoir insérer dans couple_members AVANT d'en être membre)
-- ============================================================================

-- Crée un nouveau couple et y ajoute l'utilisateur courant comme membre "a".
-- À appeler une seule fois, par la première personne qui utilise l'appli.
create or replace function create_couple(a_name text default 'Rémy', b_name text default 'Partenaire')
returns uuid
language plpgsql
security definer
as $$
declare
  new_couple_id uuid;
begin
  insert into couples (member_a_name, member_b_name) values (a_name, b_name)
    returning id into new_couple_id;
  insert into couple_members (couple_id, user_id, role) values (new_couple_id, auth.uid(), 'a');

  -- 8 catégories de démarrage, identiques à celles du prototype — l'utilisateur peut ensuite les personnaliser.
  insert into categories (couple_id, label, icon, color) values
    (new_couple_id, 'Logement', '🏠', '--s1'),
    (new_couple_id, 'Courses', '🛒', '--s2'),
    (new_couple_id, 'Restos & sorties', '🍽️', '--s3'),
    (new_couple_id, 'Transport', '🚗', '--s4'),
    (new_couple_id, 'Factures', '💡', '--s5'),
    (new_couple_id, 'Loisirs', '🎉', '--s6'),
    (new_couple_id, 'Santé', '➕', '--s7'),
    (new_couple_id, 'Autre', '📦', '--s8');

  return new_couple_id;
end;
$$;

-- Rejoint un couple existant via son code d'invitation, en tant que membre "b".
-- Échoue si le code est invalide ou si le rôle "b" est déjà pris.
create or replace function join_couple(code text)
returns uuid
language plpgsql
security definer
as $$
declare
  target_couple_id uuid;
begin
  select id into target_couple_id from couples where invite_code = code;
  if target_couple_id is null then
    raise exception 'Code d''invitation invalide';
  end if;
  if exists (select 1 from couple_members where couple_id = target_couple_id and role = 'b') then
    raise exception 'Ce couple a déjà deux membres';
  end if;
  insert into couple_members (couple_id, user_id, role) values (target_couple_id, auth.uid(), 'b');
  return target_couple_id;
end;
$$;
