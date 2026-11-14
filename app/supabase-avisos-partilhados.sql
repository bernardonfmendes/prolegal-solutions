-- Prolegal Solutions: lembretes de cada pessoa nos registos pessoais partilhados.
-- Quem cria um registo guarda os seus lembretes em reunioes.avisos_min (como sempre).
-- Quem o vê por partilha (dona <-> convidado) escolhe os seus aqui, sem mexer nos do outro.
-- Corre depois de supabase-convidados.sql. Pode ser corrido mais do que uma vez.

create table if not exists public.avisos_meus (
  registo_id uuid not null references public.reunioes(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  avisos_min int[] not null default '{}',
  primary key (registo_id, user_id)
);
alter table public.avisos_meus enable row level security;
drop policy if exists "avisos_meus: proprios" on public.avisos_meus;
-- Cada pessoa só vê e mexe nos seus lembretes, e só em registos que consegue ver.
create policy "avisos_meus: proprios" on public.avisos_meus
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.reunioes r where r.id = registo_id));

-- O mesmo aviso pode agora sair para duas pessoas: a proteção contra repetidos passa a ser por pessoa.
alter table public.avisos_enviados drop constraint if exists avisos_enviados_registo_id_tipo_minutos_key;
alter table public.avisos_enviados drop constraint if exists avisos_enviados_unico_por_pessoa;
alter table public.avisos_enviados add constraint avisos_enviados_unico_por_pessoa unique (registo_id, tipo, minutos, user_id);

-- Novo tipo de aviso: "o outro criou um registo pessoal".
alter table public.avisos_enviados drop constraint if exists avisos_enviados_tipo_check;
alter table public.avisos_enviados add constraint avisos_enviados_tipo_check check (tipo in ('reuniao', 'prazo', 'novo'));
