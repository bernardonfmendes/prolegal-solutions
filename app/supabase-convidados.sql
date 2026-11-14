-- Prolegal Solutions: convidados.
-- Um convidado partilha o calendário PESSOAL com a dona da conta:
--   * vê e altera os registos pessoais dos dois (e a dona vê e altera os dele);
--   * do trabalho da dona só vê "Ocupado" (hora de início e de fim), sem cliente,
--     contactos, local nem assunto (sigilo profissional);
--   * não vê prazos, faturação nem categorias de trabalho, e não cria nada de trabalho.
-- As regras estão na base de dados (RLS), não só no ecrã: a chave da app é pública.
-- Todas as regras são só para quem tem sessão iniciada (to authenticated): sem sessão não se vê nada.
-- Pode ser corrido mais do que uma vez.

create table if not exists public.convidados (
  convidado uuid primary key references auth.users(id) on delete cascade,
  dono      uuid not null references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now(),
  check (convidado <> dono)
);
alter table public.convidados enable row level security;
drop policy if exists "convidados: ver a propria ligacao" on public.convidados;
create policy "convidados: ver a propria ligacao" on public.convidados
  for select to authenticated using (auth.uid() in (convidado, dono));
-- Sem políticas de escrita: um convidado só se acrescenta pelo painel ou por SQL.

-- ---------- funções auxiliares ----------
-- security definer para lerem as tabelas sem entrar em recursão com as próprias regras.

create or replace function public.e_convidado() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from convidados where convidado = auth.uid());
$$;

-- Quem partilha o calendário pessoal comigo: eu, a minha dona, os convidados dela, os meus convidados.
create or replace function public.agregado() returns setof uuid
language sql stable security definer set search_path = public as $$
  select auth.uid()
  union select dono from convidados where convidado = auth.uid()
  union select convidado from convidados where dono = auth.uid()
  union select c2.convidado from convidados c1 join convidados c2 on c2.dono = c1.dono where c1.convidado = auth.uid();
$$;

-- A categoria é pessoal e pertence a alguém do meu agregado?
create or replace function public.cat_pessoal_partilhada(cat uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from categorias where id = cat and pessoal and user_id in (select agregado()));
$$;

-- Trabalho da dona, para o convidado: só quando está ocupada. Nada mais sai daqui.
create or replace function public.ocupado()
returns table (inicio timestamptz, fim timestamptz, dia_todo boolean)
language sql stable security definer set search_path = public as $$
  select r.inicio, r.fim, coalesce(r.dia_todo, false)
  from reunioes r
  left join categorias c on c.id = r.categoria_id
  where r.user_id in (select dono from convidados where convidado = auth.uid())
    and coalesce(c.pessoal, false) = false
    and r.estado <> 'cancelada';
$$;

revoke all on function public.e_convidado(), public.agregado(), public.cat_pessoal_partilhada(uuid), public.ocupado() from public, anon;
grant execute on function public.e_convidado(), public.agregado(), public.cat_pessoal_partilhada(uuid), public.ocupado() to authenticated;

-- ---------- reuniões ----------
-- A dona continua com acesso total ao que é dela. Um convidado não usa esta regra.
drop policy if exists "reunioes: proprias" on public.reunioes;
create policy "reunioes: proprias" on public.reunioes
  for all to authenticated using (auth.uid() = user_id and not public.e_convidado())
  with check (auth.uid() = user_id and not public.e_convidado());

-- Registos pessoais: partilhados dentro do agregado, e nunca podem passar a trabalho.
drop policy if exists "reunioes: pessoais partilhadas - ver" on public.reunioes;
create policy "reunioes: pessoais partilhadas - ver" on public.reunioes
  for select to authenticated
  using (user_id in (select public.agregado()) and public.cat_pessoal_partilhada(categoria_id));

drop policy if exists "reunioes: pessoais partilhadas - criar" on public.reunioes;
create policy "reunioes: pessoais partilhadas - criar" on public.reunioes
  for insert to authenticated
  with check (user_id = auth.uid() and public.cat_pessoal_partilhada(categoria_id));

drop policy if exists "reunioes: pessoais partilhadas - alterar" on public.reunioes;
create policy "reunioes: pessoais partilhadas - alterar" on public.reunioes
  for update to authenticated
  using (user_id in (select public.agregado()) and public.cat_pessoal_partilhada(categoria_id))
  with check (user_id in (select public.agregado()) and public.cat_pessoal_partilhada(categoria_id));

drop policy if exists "reunioes: pessoais partilhadas - apagar" on public.reunioes;
create policy "reunioes: pessoais partilhadas - apagar" on public.reunioes
  for delete to authenticated
  using (user_id in (select public.agregado()) and public.cat_pessoal_partilhada(categoria_id));

-- ---------- prazos: um convidado não vê nem cria ----------
drop policy if exists "prazos: proprios" on public.prazos;
create policy "prazos: proprios" on public.prazos
  for all to authenticated using (auth.uid() = user_id and not public.e_convidado())
  with check (auth.uid() = user_id and not public.e_convidado());

-- ---------- categorias: o convidado vê só as pessoais da dona, sem as alterar ----------
drop policy if exists "categorias: proprias" on public.categorias;
create policy "categorias: proprias" on public.categorias
  for all to authenticated using (auth.uid() = user_id and not public.e_convidado())
  with check (auth.uid() = user_id and not public.e_convidado());

drop policy if exists "categorias: pessoais da dona" on public.categorias;
create policy "categorias: pessoais da dona" on public.categorias
  for select to authenticated
  using (pessoal and user_id in (select public.agregado()));
