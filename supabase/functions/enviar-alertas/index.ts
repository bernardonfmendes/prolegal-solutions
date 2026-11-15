// Prolegal Solutions: envia os alertas de reuniões e prazos por Web Push.
// Corre sozinha de minuto a minuto. Sem dependências: a criptografia é a do próprio Deno.
import { cifrar, vapid } from './webpush.ts';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const CHAVE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Lido só quando é preciso: um segredo em falta dá uma mensagem clara,
// em vez de matar a função no arranque com um erro sem explicação.
function lerVapid() {
  const bruto = Deno.env.get('VAPID_JWK');
  if (!bruto) throw new Error('Falta o segredo VAPID_JWK nas Edge Functions.');
  let jwk;
  try { jwk = JSON.parse(bruto); } catch { throw new Error('VAPID_JWK não é JSON válido.'); }
  if (!jwk || jwk.kty !== 'EC' || !jwk.d || !jwk.x || !jwk.y) throw new Error('VAPID_JWK não tem o formato esperado (kty, d, x, y).');
  return jwk;
}
const ASSUNTO = Deno.env.get('VAPID_SUBJECT') || 'mailto:geral@prolegalsolutions.pt';
const ZONA = 'Europe/Lisbon';
const HORA_PRAZO = 8; // os avisos de prazos saem de manhã
const FOLGA_MS = 15 * 60000; // cobre o intervalo do cron e uma execução falhada

async function sb(caminho: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_SB}/rest/v1/${caminho}`, {
    ...init,
    headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  if (!r.ok) throw new Error(`${caminho}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : await r.json();
}

// O instante UTC que corresponde a uma hora local em Lisboa, num certo dia
function instanteEmLisboa(dia: string, hora: number, minuto = 0): Date {
  const [a, m, d] = dia.split('-').map(Number);
  for (const desvio of [0, -1, 1, 2]) {           // tenta os desvios possíveis (inverno/verão)
    const t = new Date(Date.UTC(a, m - 1, d, hora - desvio, minuto, 0));
    const partes = new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONA, hour: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(t);
    const v = Object.fromEntries(partes.map((p) => [p.type, p.value]));
    if (Number(v.hour) === hora && Number(v.day) === d && Number(v.month) === m && Number(v.year) === a) return t;
  }
  return new Date(Date.UTC(a, m - 1, d, hora, minuto, 0));
}

// ---------- repetições (a mesma regra da app, em app.js) ----------
// Registos que não se repetem usam esta "ocorrência" fixa: os avisos já enviados continuam válidos.
const SEM_REPETICAO = '1970-01-01';
const REPETE = new Set(['semanal', 'quinzenal', 'mensal', 'anual']);
// A série que começa no dia `base` (AAAA-MM-DD) tem uma ocorrência no dia `dia`?
// Dia 31 "todos os meses" cai no último dia dos meses curtos; 29/02 a 28/02 nos anos comuns.
function ocorreEm(base: string, repetir: string, dia: string): boolean {
  const [by, bm, bd] = base.split('-').map(Number);
  const [y, m, d] = dia.split('-').map(Number);
  const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(by, bm - 1, bd)) / 86400000);
  if (n < 0) return false;
  if (n === 0) return true;
  const mesmoDiaDoMes = d === Math.min(bd, new Date(Date.UTC(y, m, 0)).getUTCDate());
  switch (repetir) {
    case 'semanal': return n % 7 === 0;
    case 'quinzenal': return n % 14 === 0;
    case 'mensal': return mesmoDiaDoMes;
    case 'anual': return m === bm && mesmoDiaDoMes;
    default: return false;
  }
}
const somaDias = (dia: string, n: number) => {
  const [y, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
function horaMinEmLisboa(iso: string): [number, number] {
  const v = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return [Number(v.hour) % 24, Number(v.minute)];
}
// Cada vez que a reunião acontece entre `desde` e `ate`, à mesma hora de Lisboa (acerta a mudança da hora)
function ocorrencias(m: { inicio: string; repetir?: string }, desde: Date, ate: Date): { inicio: string; ocorrencia: string }[] {
  if (!REPETE.has(m.repetir || '')) return [{ inicio: m.inicio, ocorrencia: SEM_REPETICAO }];
  const base = diaDe(m.inicio);
  const [h, mi] = horaMinEmLisboa(m.inicio);
  const out: { inicio: string; ocorrencia: string }[] = [];
  for (let dia = diaDe(desde.toISOString()); dia <= diaDe(ate.toISOString()); dia = somaDias(dia, 1)) {
    if (!ocorreEm(base, m.repetir!, dia)) continue;
    const t = instanteEmLisboa(dia, h, mi);
    if (t >= desde && t <= ate) out.push({ inicio: t.toISOString(), ocorrencia: dia });
  }
  return out;
}

const fmtHora = (iso: string) =>
  new Intl.DateTimeFormat('pt-PT', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const diaHora = (iso: string, diaTodo?: boolean) =>
  new Intl.DateTimeFormat('pt-PT', diaTodo
    ? { timeZone: ZONA, weekday: 'short', day: '2-digit', month: '2-digit' }
    : { timeZone: ZONA, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const diaDe = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

function quantoFalta(min: number) {
  if (min <= 0) return 'agora';
  if (min < 60) return `em ${min} min`;
  if (min < 1440) return `em ${Math.round(min / 60)} h`;
  const d = Math.round(min / 1440);
  return d === 1 ? 'amanhã' : `em ${d} dias`;
}

async function enviar(sub: any, dados: Record<string, unknown>) {
  const corpo = await cifrar(sub.p256dh, sub.auth, JSON.stringify(dados));
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapid(sub.endpoint, lerVapid(), ASSUNTO),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400'
    },
    body: corpo
  });
  return r;
}

Deno.serve(async () => {
  const agora = new Date();
  const relatorio = { reunioes: 0, prazos: 0, enviados: 0, removidos: 0, erros: [] as string[] };

  try {
    lerVapid();   // falha já aqui, com motivo, se o segredo não estiver posto
    const limite = new Date(agora.getTime() + 8 * 86400000).toISOString();
    // O cron corre de 5 em 5 minutos. Um aviso "na hora" (ou a poucos minutos do início) cai
    // entre duas execuções, e a seguinte já encontra a reunião começada. Por isso também se
    // olha para reuniões que começaram há pouco (FOLGA), para esse aviso não se perder.
    const desde = new Date(agora.getTime() - FOLGA_MS).toISOString();
    const [reunioes, prazos, subs, convidados, catsPessoais, meus, novos] = await Promise.all([
      // As que começam nesta janela e todas as que se repetem (a próxima vez pode cair nesta janela)
      sb(`reunioes?select=id,user_id,cliente,inicio,avisos_min,estado,local,categoria_id,repetir&estado=eq.agendada&inicio=lte.${limite}&or=(inicio.gte.${desde},repetir.neq.nunca)`),
      sb(`prazos?select=id,user_id,descricao,data_limite,avisos,concluido,repetir&concluido=is.false`),
      sb(`push_subs?select=id,user_id,endpoint,p256dh,auth`),
      sb(`convidados?select=dono,convidado`).catch(() => []),
      sb(`categorias?select=id&pessoal=is.true`),
      sb(`avisos_meus?select=registo_id,user_id,avisos_min`).catch(() => []),
      // Registos criados há pouco, para avisar o outro (dona <-> convidado)
      sb(`reunioes?select=id,user_id,cliente,inicio,dia_todo,categoria_id&created_at=gte.${desde}&inicio=gte.${agora.toISOString()}`)
    ]);

    // Registos pessoais são partilhados entre a dona e os seus convidados
    const pessoais = new Set(catsPessoais.map((c: any) => c.id));
    const porDono = new Map<string, string[]>();
    for (const c of convidados) { if (!porDono.has(c.dono)) porDono.set(c.dono, [c.dono]); porDono.get(c.dono)!.push(c.convidado); }
    const grupo = new Map<string, string[]>();
    for (const membros of porDono.values()) for (const u of membros) grupo.set(u, membros);
    const membrosDe = (u: string) => grupo.get(u) || [u];
    // Lembretes que cada um escolheu nos registos criados pelo outro
    const avisosMeus = new Map<string, number[]>(meus.map((a: any) => [`${a.registo_id}|${a.user_id}`, a.avisos_min || []]));

    const porUser = new Map<string, any[]>();
    for (const s of subs) { if (!porUser.has(s.user_id)) porUser.set(s.user_id, []); porUser.get(s.user_id)!.push(s); }

    type Pendente = { user_id: string; registo_id: string; tipo: 'reuniao' | 'prazo' | 'novo'; minutos: number; ocorrencia: string; titulo: string; corpo: string; dia: string };
    const pendentes: Pendente[] = [];

    for (const r of reunioes) for (const o of ocorrencias(r, new Date(desde), new Date(limite))) {
      // Numa repetição, "m" é a reunião nesse dia (mesma hora); "o.ocorrencia" distingue cada semana/mês
      const m = { ...r, inicio: o.inicio };
      const t = new Date(m.inicio).getTime();
      const pessoal = pessoais.has(m.categoria_id);
      // Quanto falta de facto: um aviso que saia atrasado (ou de uma reunião criada em cima
      // da hora) diz a verdade, em vez de repetir o intervalo configurado.
      const falta = Math.max(0, Math.round((t - agora.getTime()) / 60000));
      // Trabalho: só quem o criou. Pessoal: cada pessoa do grupo, com os seus próprios lembretes.
      for (const u of (pessoal ? membrosDe(m.user_id) : [m.user_id])) {
      const lista: number[] = u === m.user_id ? (m.avisos_min || []) : (avisosMeus.get(`${m.id}|${u}`) || []);
      for (const min of lista) {
        if (agora.getTime() >= t - min * 60000 && agora.getTime() <= t + FOLGA_MS) {
          pendentes.push({
            user_id: u, registo_id: m.id, tipo: 'reuniao', minutos: min, ocorrencia: o.ocorrencia,
            titulo: `${m.cliente || 'Reunião'} ${falta === 0 ? (t < agora.getTime() ? 'já começou' : 'agora') : quantoFalta(falta)}`,
            corpo: `${fmtHora(m.inicio)}${m.local ? ' · ' + m.local : ''}`,
            dia: diaDe(m.inicio)
          });
        }
      }
      }
    }

    // Um registo pessoal novo avisa logo os outros do grupo (nunca quem o criou)
    for (const m of novos) {
      if (!pessoais.has(m.categoria_id)) continue;
      for (const u of membrosDe(m.user_id)) {
        if (u === m.user_id) continue;
        pendentes.push({
          user_id: u, registo_id: m.id, tipo: 'novo', minutos: 0, ocorrencia: SEM_REPETICAO,
          titulo: 'Novo registo pessoal',
          corpo: `${m.cliente || 'Sem título'} · ${diaHora(m.inicio, m.dia_todo)}`,
          dia: diaDe(m.inicio)
        });
      }
    }

    for (const p of prazos) {
      for (const dias of (p.avisos || [])) {
        const quando = new Date(instanteEmLisboa(p.data_limite, HORA_PRAZO).getTime() - dias * 86400000);
        if (agora >= quando && agora.getTime() - quando.getTime() < 36 * 3600000) {
          pendentes.push({
            // Um prazo que se repete avança a data_limite quando é concluído: cada data é uma ocorrência
            user_id: p.user_id, registo_id: p.id, tipo: 'prazo', minutos: dias,
            ocorrencia: REPETE.has(p.repetir) ? p.data_limite : SEM_REPETICAO,
            titulo: dias === 0 ? 'Prazo termina hoje' : `Prazo ${quantoFalta(dias * 1440)}`,
            corpo: p.descricao || '',
            dia: p.data_limite
          });
        }
      }
    }

    // Marcar primeiro. Se já lá estiver, este aviso já saiu e não se repete.
    // Se supabase-repeticoes.sql ainda não tiver corrido (sem a coluna "ocorrencia"), marca como
    // antes: os avisos continuam a sair, só as repetições ficam limitadas ao primeiro aviso.
    let semOcorrencia = false;
    const marcar = (a: Pendente) => fetch(`${URL_SB}/rest/v1/avisos_enviados?on_conflict=registo_id,tipo,minutos,user_id${semOcorrencia ? '' : ',ocorrencia'}`, {
      method: 'POST',
      headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ user_id: a.user_id, registo_id: a.registo_id, tipo: a.tipo, minutos: a.minutos, ...(semOcorrencia ? {} : { ocorrencia: a.ocorrencia }) })
    });
    for (const a of pendentes) {
      let r = await marcar(a);
      if (!semOcorrencia && r.status === 400) {
        const erro = await r.text();
        if (/ocorrencia|42P10|PGRST204/.test(erro)) { semOcorrencia = true; r = await marcar(a); }
        else { relatorio.erros.push(`avisos_enviados: ${erro.slice(0, 160)}`); continue; }
      }
      const criado = await r.json().catch(() => []);
      if (!r.ok || !Array.isArray(criado) || criado.length === 0) continue;   // já tinha sido enviado

      if (a.tipo === 'prazo') relatorio.prazos++; else relatorio.reunioes++;

      for (const s of (porUser.get(a.user_id) || [])) {
        try {
          const res = await enviar(s, { titulo: a.titulo, corpo: a.corpo, dia: a.dia, tag: `${a.tipo}-${a.registo_id}-${a.ocorrencia}` });
          if (res.status === 404 || res.status === 410) {
            await sb(`push_subs?id=eq.${s.id}`, { method: 'DELETE' });   // dispositivo já não existe
            relatorio.removidos++;
          } else if (!res.ok) {
            relatorio.erros.push(`${res.status} ${(await res.text()).slice(0, 120)}`);
          } else {
            relatorio.enviados++;
          }
        } catch (e) {
          relatorio.erros.push(String(e).slice(0, 160));
        }
      }
    }
  } catch (e) {
    relatorio.erros.push(String(e).slice(0, 300));
  }

  return new Response(JSON.stringify(relatorio), { headers: { 'Content-Type': 'application/json' } });
});
