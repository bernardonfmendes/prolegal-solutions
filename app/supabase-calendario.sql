-- Prolegal Solutions: calendário com categorias e campos novos.
-- Correr em Supabase → SQL Editor → New query → Run. Pode correr mais do que uma vez sem problema.

-- 1) Categorias com cor, por utilizador
create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  cor text not null default '#1f3160',
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.categorias enable row level security;
drop policy if exists "categorias: proprias" on public.categorias;
create policy "categorias: proprias" on public.categorias
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) Campos novos nas reuniões
--    (o aviso por evento já existe: reunioes.avisos_min e prazos.avisos)
alter table public.reunioes add column if not exists fim          timestamptz;
alter table public.reunioes add column if not exists dia_todo     boolean not null default false;
alter table public.reunioes add column if not exists local         text;
alter table public.reunioes add column if not exists repetir       text not null default 'nunca';
alter table public.reunioes add column if not exists categoria_id  uuid references public.categorias(id) on delete set null;

-- 3) Campos novos nos prazos
alter table public.prazos   add column if not exists hora          time;
alter table public.prazos   add column if not exists local         text;
alter table public.prazos   add column if not exists repetir       text not null default 'nunca';
alter table public.prazos   add column if not exists categoria_id  uuid references public.categorias(id) on delete set null;

-- 4) Só valores previstos na repetição
alter table public.reunioes drop constraint if exists reunioes_repetir_ck;
alter table public.reunioes add  constraint reunioes_repetir_ck
  check (repetir in ('nunca','semanal','quinzenal','mensal','anual'));
alter table public.prazos   drop constraint if exists prazos_repetir_ck;
alter table public.prazos   add  constraint prazos_repetir_ck
  check (repetir in ('nunca','semanal','quinzenal','mensal','anual'));

-- 5) Procurar por data fica rápido
create index if not exists reunioes_user_inicio_idx on public.reunioes (user_id, inicio);
create index if not exists prazos_user_data_idx     on public.prazos   (user_id, data_limite);

-- 6) Categorias iniciais, uma vez por utilizador que já tenha registos
insert into public.categorias (user_id, nome, cor, ordem)
select u.id, c.nome, c.cor, c.ordem
from auth.users u
cross join (values
  ('Reunião',    '#1f3160', 1),
  ('Audiência',  '#b42318', 2),
  ('Prazo',      '#b54708', 3),
  ('Diligência', '#067647', 4),
  ('Pessoal',    '#6941c6', 5)
) as c(nome, cor, ordem)
where not exists (select 1 from public.categorias k where k.user_id = u.id);

-- 7) Pôr as reuniões e prazos que já existem nas categorias certas
update public.reunioes r set categoria_id = k.id
from public.categorias k
where k.user_id = r.user_id and k.nome = 'Reunião' and r.categoria_id is null;

update public.prazos p set categoria_id = k.id
from public.categorias k
where k.user_id = p.user_id and k.nome = 'Prazo' and p.categoria_id is null;
