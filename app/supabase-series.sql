-- Prolegal Solutions: séries como no calendário da Apple.
--   * "Terminar repetição" numa data (repetir_ate: último dia em que a série acontece).
--   * "Só este evento": dias tirados da série (excecoes), por terem sido apagados ou mudados à parte.
-- Corre depois de supabase-repeticoes.sql. Pode ser corrido mais do que uma vez.
-- Enquanto não correr, a app funciona na mesma: só estas duas opções avisam que não estão ativas.

alter table public.reunioes add column if not exists repetir_ate date;
alter table public.reunioes add column if not exists excecoes date[];

-- O convidado vê "Ocupado" com as mesmas regras (fim da série, dias tirados, vários dias).
-- Continua a não sair cliente, local nem assunto.
drop function if exists public.ocupado();
create function public.ocupado()
returns table (inicio timestamptz, fim timestamptz, dia_todo boolean, repetir text, dias_semana smallint[], repetir_ate date, excecoes date[])
language sql stable security definer set search_path = public as $$
  select r.inicio, r.fim, coalesce(r.dia_todo, false), coalesce(r.repetir, 'nunca'), r.dias_semana, r.repetir_ate, r.excecoes
  from reunioes r
  left join categorias c on c.id = r.categoria_id
  where r.user_id in (select dono from convidados where convidado = auth.uid())
    and coalesce(c.pessoal, false) = false
    and r.estado <> 'cancelada';
$$;
revoke all on function public.ocupado() from public, anon;
grant execute on function public.ocupado() to authenticated;
