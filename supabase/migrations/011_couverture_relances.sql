-- 6.8.0 — Couverture hebdomadaire des parcs (semaine du lundi au vendredi) et relances
alter table public.parcs add column if not exists contact_nom text;
alter table public.parcs add column if not exists contact_email text;
alter table public.parcs add column if not exists contact_tel text;
-- false : parc fermé ou sans véhicule, exclu du calcul de la couverture
alter table public.parcs add column if not exists suivi_hebdo boolean not null default true;

create table if not exists public.stock_relances (
  id bigserial primary key,
  parc_id bigint not null references public.parcs(id) on delete cascade,
  semaine date not null,            -- lundi de la semaine concernée
  niveau int not null default 1,    -- 1 : première relance, 2 : relance ferme
  canal text,                       -- outlook, copie
  by_uid text, by_name text,
  at timestamptz not null default now()
);
create index if not exists stock_relances_parc_idx on public.stock_relances(parc_id, semaine);
create index if not exists stays_last_import_idx on public.stays(last_import_id);
alter table public.stock_relances enable row level security;
revoke all on public.stock_relances from anon, authenticated;
