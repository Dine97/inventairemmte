-- STOCK MMTE v1 : structure de la base (projet Supabase stock-mmte)
create extension if not exists pg_trgm with schema extensions;

create table public.parcs (
  id bigserial primary key, name text not null unique, active boolean not null default true, note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now(), updated_by text);
insert into public.settings(key, value) values
 ('duree_sejour', '365'), ('seuil_alerte', '30'), ('afficher_transfert', 'true'), ('fenetre_transfert', '30'),
 ('types_sortie', '["Mise à la consommation (déclaration payée)","Transfert","Réexportation","Transit","Erreur de fichier","Autre"]');

create table public.vehicles (
  id bigserial primary key, chassis text not null unique, chassis_raw text,
  marque text, modele text, annee text, navire text, manifeste text, bl text,
  date_arrivee date, date_transfert date, importateur text,
  data jsonb not null default '{}'::jsonb, current_parc_id bigint references public.parcs(id), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index vehicles_chassis_trgm on public.vehicles using gin (chassis extensions.gin_trgm_ops);
create index vehicles_marque_trgm on public.vehicles using gin ((coalesce(marque,'')||' '||coalesce(modele,'')) extensions.gin_trgm_ops);
create index vehicles_navire_idx on public.vehicles (navire);
create index vehicles_parc_idx on public.vehicles (current_parc_id);

create table public.imports (
  id bigserial primary key, parc_id bigint not null references public.parcs(id), stock_date date not null,
  file_name text, file_size integer, sheets text[], header_row integer, mapping jsonb, declared jsonb,
  anomalies jsonb not null default '[]'::jsonb, nb_lignes integer not null default 0, nb_chassis integer not null default 0,
  nb_entrees integer not null default 0, nb_sorties integer not null default 0, nb_transferts integer not null default 0,
  is_initial boolean not null default false, side_effects jsonb not null default '[]'::jsonb, comment text,
  status text not null default 'valide' check (status in ('valide','annule')),
  cancel_reason text, cancelled_at timestamptz, cancelled_by text, created_by_uid text, created_by_name text,
  created_at timestamptz not null default now()
);
create index imports_parc_idx on public.imports (parc_id, stock_date desc);

create table public.stays (
  id bigserial primary key,
  vehicle_id bigint not null references public.vehicles(id) on delete cascade,
  parc_id bigint not null references public.parcs(id),
  entry_import_id bigint references public.imports(id) on delete set null, entry_date date not null,
  entry_kind text not null default 'entree' check (entry_kind in ('initial','entree','transfert','manuel')),
  from_parc_id bigint references public.parcs(id),
  exit_import_id bigint references public.imports(id) on delete set null, exit_date date,
  exit_kind text check (exit_kind in ('sortie','transfert','erreur','manuel')),
  to_parc_id bigint references public.parcs(id),
  last_import_id bigint references public.imports(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  justif_type text, justif_numero text, justif_date date, justif_bureau text, justif_note text,
  justif_files jsonb not null default '[]'::jsonb,
  justif_status text not null default 'non_justifiee' check (justif_status in ('non_justifiee','justifiee','validee')),
  justif_by text, justif_at timestamptz, valide_by text, valide_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index stays_vehicle_idx on public.stays (vehicle_id);
create index stays_parc_open_idx on public.stays (parc_id) where exit_date is null and deleted_at is null;
create index stays_entry_idx on public.stays (parc_id, entry_date);
create index stays_exit_idx on public.stays (parc_id, exit_date);
create index stays_numero_idx on public.stays (justif_numero);

create table public.file_templates (
  id bigserial primary key, parc_id bigint references public.parcs(id) on delete cascade,
  signature text not null, mapping jsonb not null, header_row integer, sheet text,
  updated_at timestamptz not null default now(), updated_by text, unique (parc_id, signature)
);
create table public.column_synonyms (id bigserial primary key, field text not null, synonym text not null unique, created_at timestamptz not null default now(), created_by text);
create table public.audit_log (
  id bigserial primary key, at timestamptz not null default now(), by_uid text, by_name text,
  action text not null, entity text, entity_id text, detail text, before jsonb, after jsonb
);
create index audit_at_idx on public.audit_log (at desc);

-- Aucun accès direct depuis le navigateur : tout passe par la fonction stock-api
alter table public.parcs enable row level security;
alter table public.settings enable row level security;
alter table public.vehicles enable row level security;
alter table public.imports enable row level security;
alter table public.stays enable row level security;
alter table public.file_templates enable row level security;
alter table public.column_synonyms enable row level security;
alter table public.audit_log enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit) values ('justificatifs', 'justificatifs', false, 10485760)
on conflict (id) do nothing;
