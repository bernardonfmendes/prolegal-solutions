-- Prolegal Solutions: registos que se repetem (todas as semanas, de 15 em 15 dias, mensal, anual).
-- Um registo que se repete é uma só linha; as datas seguintes calculam-se na app e nos alertas.
-- Corre depois de supabase-avisos-partilhados.sql. Pode ser corrido mais do que uma vez.

-- ---------- 1) Alertas: o mesmo aviso pode sair uma vez POR OCORRÊNCIA ----------
-- Antes, cada aviso saía uma só vez por registo: um ténis semanal avisava só na 1.ª semana.
-- "ocorrencia" é o dia da repetição; nos registos que não se repetem fica 1970-01-01.
alter table public.avisos_enviados add column if not exists ocorrencia date not null default '1970-01-01';
create unique index if not exists avisos_enviados_unico_por_ocorrencia
  on public.avisos_enviados (registo_id, tipo, minutos, user_id, ocorrencia);

-- ---------- 2) O convidado vê "Ocupado" também nas repetições do trabalho da dona ----------
-- Continua a não sair cliente, local nem assunto: só horas e a regra de repetição.
drop function if exists public.ocupado();
create function public.ocupado()
returns table (inicio timestamptz, fim timestamptz, dia_todo boolean, repetir text)
language sql stable security definer set search_path = public as $$
  select r.inicio, r.fim, coalesce(r.dia_todo, false), coalesce(r.repetir, 'nunca')
  from reunioes r
  left join categorias c on c.id = r.categoria_id
  where r.user_id in (select dono from convidados where convidado = auth.uid())
    and coalesce(c.pessoal, false) = false
    and r.estado <> 'cancelada';
$$;
revoke all on function public.ocupado() from public, anon;
grant execute on function public.ocupado() to authenticated;

-- ---------- 3) SÓ DEPOIS de publicar a nova função enviar-alertas ----------
-- A função antiga ainda usa a regra antiga (sem "ocorrencia"); se esta linha correr antes,
-- os alertas param até a nova função estar publicada. Correr à parte, no fim:
--
--   alter table public.avisos_enviados drop constraint if exists avisos_enviados_unico_por_pessoa;
