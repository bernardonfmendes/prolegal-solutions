// Prolegal Solutions: envia os alertas de reuniões e prazos por Web Push.
// Corre sozinha de 5 em 5 minutos. Sem dependências: a criptografia é a do próprio Deno.
import { cifrar, vapid } from './webpush.ts';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const CHAVE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_JWK = JSON.parse(Deno.env.get('VAPID_JWK')!);
const ASSUNTO = Deno.env.get('VAPID_SUBJECT') || 'mailto:geral@prolegalsolutions.pt';
const ZONA = 'Europe/Lisbon';
const HORA_PRAZO = 8; // os avisos de prazos saem de manhã

async function sb(caminho: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_SB}/rest/v1/${caminho}`, {
    ...init,
    headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  if (!r.ok) throw new Error(`${caminho}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : await r.json();
}

// O instante UTC que corresponde a uma hora local em Lisboa, num certo dia
function instanteEmLisboa(dia: string, hora: number): Date {
  const [a, m, d] = dia.split('-').map(Number);
  for (const desvio of [0, -1, 1, 2]) {           // tenta os desvios possíveis (inverno/verão)
    const t = new Date(Date.UTC(a, m - 1, d, hora - desvio, 0, 0));
    const partes = new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONA, hour: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(t);
    const v = Object.fromEntries(partes.map((p) => [p.type, p.value]));
    if (Number(v.hour) === hora && Number(v.day) === d && Number(v.month) === m && Number(v.year) === a) return t;
  }
  return new Date(Date.UTC(a, m - 1, d, hora, 0, 0));
}

const fmtHora = (iso: string) =>
  new Intl.DateTimeFormat('pt-PT', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
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
      Authorization: await vapid(sub.endpoint, VAPID_JWK, ASSUNTO),
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
    const limite = new Date(agora.getTime() + 8 * 86400000).toISOString();
    const [reunioes, prazos, subs] = await Promise.all([
      sb(`reunioes?select=id,user_id,cliente,inicio,avisos_min,estado,local&estado=eq.agendada&inicio=gte.${agora.toISOString()}&inicio=lte.${limite}`),
      sb(`prazos?select=id,user_id,descricao,data_limite,avisos,concluido&concluido=is.false`),
      sb(`push_subs?select=id,user_id,endpoint,p256dh,auth`)
    ]);

    const porUser = new Map<string, any[]>();
    for (const s of subs) { if (!porUser.has(s.user_id)) porUser.set(s.user_id, []); porUser.get(s.user_id)!.push(s); }

    type Pendente = { user_id: string; registo_id: string; tipo: 'reuniao' | 'prazo'; minutos: number; titulo: string; corpo: string; dia: string };
    const pendentes: Pendente[] = [];

    for (const m of reunioes) {
      const t = new Date(m.inicio).getTime();
      for (const min of (m.avisos_min || [])) {
        if (agora.getTime() >= t - min * 60000) {
          pendentes.push({
            user_id: m.user_id, registo_id: m.id, tipo: 'reuniao', minutos: min,
            titulo: `${m.cliente || 'Reunião'} ${quantoFalta(min)}`,
            corpo: `${fmtHora(m.inicio)}${m.local ? ' · ' + m.local : ''}`,
            dia: diaDe(m.inicio)
          });
        }
      }
    }

    for (const p of prazos) {
      for (const dias of (p.avisos || [])) {
        const quando = new Date(instanteEmLisboa(p.data_limite, HORA_PRAZO).getTime() - dias * 86400000);
        if (agora >= quando && agora.getTime() - quando.getTime() < 36 * 3600000) {
          pendentes.push({
            user_id: p.user_id, registo_id: p.id, tipo: 'prazo', minutos: dias,
            titulo: dias === 0 ? 'Prazo termina hoje' : `Prazo ${quantoFalta(dias * 1440)}`,
            corpo: p.descricao || '',
            dia: p.data_limite
          });
        }
      }
    }

    for (const a of pendentes) {
      // Marcar primeiro. Se já lá estiver, este aviso já saiu e não se repete.
      const r = await fetch(`${URL_SB}/rest/v1/avisos_enviados`, {
        method: 'POST',
        headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ user_id: a.user_id, registo_id: a.registo_id, tipo: a.tipo, minutos: a.minutos })
      });
      const criado = await r.json().catch(() => []);
      if (!r.ok || !Array.isArray(criado) || criado.length === 0) continue;   // já tinha sido enviado

      if (a.tipo === 'reuniao') relatorio.reunioes++; else relatorio.prazos++;

      for (const s of (porUser.get(a.user_id) || [])) {
        try {
          const res = await enviar(s, { titulo: a.titulo, corpo: a.corpo, dia: a.dia, tag: `${a.tipo}-${a.registo_id}` });
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
