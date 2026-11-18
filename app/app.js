/* Prolegal Solutions: agenda, prazos e faturação. */
(() => {
  'use strict';

  // Proteção contra clickjacking: a app nunca deve abrir dentro de uma moldura de outro site.
  if (window.top !== window.self) {
    document.documentElement.innerHTML = '';
    try { window.top.location.replace(window.location.href); } catch (e) { /* bloqueado pelo browser */ }
    return;
  }

  const cfg = window.APP_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtEur = (n) => (Number(n) || 0).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
  const fmtDataHora = (iso) => new Date(iso).toLocaleString('pt-PT', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtDia = (iso) => new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
  const LABEL = { agendada: 'Agendada', realizada: 'Realizada', cancelada: 'Cancelada' };
  const HORA_MS = 3600 * 1000;

  let sb = null;
  let user = null;
  let reunioes = [];
  let prazos = [];
  let categorias = [];
  let esquemaNovo = false; // fica true quando a migração do calendário já correu
  // Convidado: partilha só o calendário pessoal; do trabalho da dona vê apenas "Ocupado".
  // As regras a sério estão na base de dados (supabase-convidados.sql); aqui só se adapta o ecrã.
  let modoConvidado = false;
  let ocupados = [];
  // "A minha cor" de cada pessoa (user_id -> cor), para pintar os registos pessoais de quem os criou
  let cores = new Map();
  // Os meus lembretes nos registos pessoais criados pelo outro (registo_id -> minutos)
  let avisosMeus = new Map();
  const CORES = ['#1f3160', '#b42318', '#b54708', '#067647', '#6941c6', '#b8924a', '#0e7090', '#be185d'];
  const CAT_REUNIAO = { nome: 'Reunião', cor: '#1f3160' };
  const CAT_PRAZO = { nome: 'Prazo', cor: '#b54708' };
  let mesCal = startOfMonth(new Date());
  let diaSel = startOfDay(new Date());

  // ---------- utilitários de data ----------
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function startOfMonth(d) { const x = startOfDay(d); x.setDate(1); return x; }
  function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function toLocalInput(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function daysUntil(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const due = new Date(y, m - 1, d);
    return Math.round((due - startOfDay(new Date())) / 86400000);
  }
  function fmtDataSimples(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ---------- repetições ----------
  // Um registo que se repete continua a ser uma só linha na base de dados; as datas seguintes
  // calculam-se aqui. Editar muda a série toda. A mesma regra está nos alertas (enviar-alertas).
  const REPETE = { semanal: 'Todas as semanas', quinzenal: 'De 15 em 15 dias', mensal: 'Todos os meses', anual: 'Todos os anos' };
  const diaDeTexto = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  // Dias de calendário entre duas datas, sem tropeçar na mudança da hora
  const diasEntre = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  const ultimoDiaDoMes = (y, m) => new Date(y, m + 1, 0).getDate();
  const DIAS_CURTOS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const diaIso = (d) => ((d.getDay() + 6) % 7) + 1;          // 1 = segunda … 7 = domingo
  const segundaDe = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - diaIso(d) + 1);
  // Dias escolhidos para "todas as semanas" / "de 15 em 15 dias" (vazio = o dia da semana do início)
  const diasDaSerie = (repetir, dias) => ((repetir === 'semanal' || repetir === 'quinzenal') && Array.isArray(dias) && dias.length ? dias : null);
  // A série que começa em `base` tem uma ocorrência no dia `dia`?
  // Com dias escolhidos: nesses dias da semana (de 15 em 15 dias, uma semana sim, outra não).
  // Dia 31 "todos os meses" cai no último dia dos meses mais curtos; 29 de fevereiro, a 28 nos anos comuns.
  function ocorreEm(base, repetir, dia, dias) {
    const n = diasEntre(base, dia);
    if (n < 0) return false;
    const escolhidos = diasDaSerie(repetir, dias);
    if (escolhidos) {
      if (!escolhidos.includes(diaIso(dia))) return false;
      return repetir === 'semanal' || (diasEntre(segundaDe(base), segundaDe(dia)) / 7) % 2 === 0;
    }
    if (n === 0) return true;
    const mesmoDiaDoMes = () => dia.getDate() === Math.min(base.getDate(), ultimoDiaDoMes(dia.getFullYear(), dia.getMonth()));
    switch (repetir) {
      case 'semanal': return n % 7 === 0;
      case 'quinzenal': return n % 14 === 0;
      case 'mensal': return mesmoDiaDoMes();
      case 'anual': return dia.getMonth() === base.getMonth() && mesmoDiaDoMes();
      default: return false;
    }
  }
  const repete = (x) => !!(x && x.repetir && x.repetir !== 'nunca');
  // A série acontece neste dia? Respeita "terminar repetição" e os dias apagados/mudados só uma vez.
  function ocorre(m, dia) {
    const base = new Date(m.inicio);
    if (!repete(m)) return diasEntre(base, dia) === 0;
    const k = dayKey(dia);
    if (m.repetir_ate && k > m.repetir_ate) return false;
    if (Array.isArray(m.excecoes) && m.excecoes.includes(k)) return false;
    return ocorreEm(base, m.repetir, dia, m.dias_semana);
  }
  // Quantos dias a mais ocupa cada ocorrência (0 = só um dia). Acabar às 00:00 conta para o dia anterior.
  function diasExtra(m) {
    if (!m.fim) return 0;
    const ini = new Date(m.inicio);
    const fim = new Date(m.fim);
    if (fim <= ini) return 0;
    if (!m.dia_todo && fim.getHours() === 0 && fim.getMinutes() === 0) fim.setMinutes(-1);
    return Math.min(62, Math.max(0, diasEntre(ini, fim)));
  }
  // A ocorrência que está a decorrer em `dia`: começou nesse dia, ou antes e ainda não acabou
  function ocorrenciaNoDia(m, dia) {
    const extra = diasExtra(m);
    for (let k = 0; k <= extra; k++) {
      const inicio = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() - k);
      if (ocorre(m, inicio)) return { inicio, parte: k, dias: extra + 1 };
    }
    return null;
  }
  // Próxima vez que a série acontece (ou está a decorrer) a partir de `desde`
  function proximaOcorrencia(m, desde) {
    const d = startOfDay(desde);
    for (let i = 0; i < 800; i++, d.setDate(d.getDate() + 1)) {
      const o = ocorrenciaNoDia(m, d);
      if (o) return o.inicio;
    }
    return null;
  }
  const fmtData = (d) => new Date(d).toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const fmtHoraCurta = (d) => new Date(d).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  // "quinta, 19/11 · Dia todo" · "quinta, 19/11, 10:00 – 11:00" · "sexta, 20/11, 22:00 – sábado, 21/11, 02:00"
  function textoQuando(m) {
    const ini = new Date(m.inicio);
    const extra = diasExtra(m);
    if (m.dia_todo) {
      const ultimo = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + extra);
      return extra ? `${fmtData(ini)} – ${fmtData(ultimo)} · Dia todo` : `${fmtData(ini)} · Dia todo`;
    }
    if (!m.fim) return fmtDataHora(m.inicio);
    return extra ? `${fmtDataHora(m.inicio)} – ${fmtDataHora(m.fim)}` : `${fmtDataHora(m.inicio)} – ${fmtHoraCurta(m.fim)}`;
  }
  const diaAnterior = (key) => { const d = diaDeTexto(key); d.setDate(d.getDate() - 1); return dayKey(d); };
  // "Todas as semanas · Seg, Qui"
  const textoSerie = (x) => (REPETE[x.repetir] || '') + (diasDaSerie(x.repetir, x.dias_semana) ? ' · ' + [...x.dias_semana].sort().map((d) => DIAS_CURTOS[d - 1]).join(', ') : '');
  // A mesma reunião (ou "ocupado") noutro dia: mesma hora e duração
  function naData(m, dia) {
    const ini = new Date(m.inicio);
    const n = diasEntre(ini, dia);
    if (n === 0) return m;
    const mover = (iso) => { const t = new Date(iso); t.setFullYear(dia.getFullYear(), dia.getMonth(), dia.getDate() + diasEntre(ini, t)); return t.toISOString(); };
    return { ...m, inicio: mover(m.inicio), fim: m.fim ? mover(m.fim) : m.fim, _repeticao: true };
  }
  // Primeira ocorrência a partir de `desde` (inclusive), ou null se não houver
  function proximaData(base, repetir, desde, dias) {
    const d = startOfDay(desde < base ? base : desde);
    for (let i = 0; i < 800; i++, d.setDate(d.getDate() + 1)) if (ocorreEm(base, repetir, d, dias)) return new Date(d);
    return null;
  }

  // ---------- feedback ----------
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ---------- inicialização ----------
  function configOk() {
    return cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
      !cfg.SUPABASE_URL.includes('COLE_AQUI') && !cfg.SUPABASE_ANON_KEY.includes('COLE_AQUI');
  }

  function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    if (!configOk() || !window.supabase) {
      $('#config-aviso').textContent = 'A app ainda não está ligada ao Supabase. Configure o config.js.';
      $('#config-aviso').classList.remove('hidden');
      $('#auth').hidden = false;
      return;
    }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    sb.auth.onAuthStateChange((_event, session) => {
      user = session?.user || null;
      if (user) loadAll();
      else { reunioes = []; prazos = []; }
      render();
    });
    // Voltar à app (mesmo sem a fechar) também conta como ver as notificações
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && user) atualizarBadge(); });
    $('#fact-mes').value = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}`;
  }

  function render() {
    $('#auth').hidden = !!user || !configOk();
    $('#app').hidden = !user;
    if (user) renderAll();
  }

  // ---------- dados ----------
  async function loadAll() {
    const [r, p, c, conv, av, pf] = await Promise.all([
      sb.from('reunioes').select('*').order('inicio', { ascending: true }),
      sb.from('prazos').select('*').order('data_limite', { ascending: true }),
      sb.from('categorias').select('*').order('ordem', { ascending: true }),
      // Se a migração dos convidados ainda não correu, dá erro e a app segue como antes
      sb.from('convidados').select('dono').eq('convidado', user.id),
      sb.from('avisos_meus').select('registo_id,avisos_min'),
      // Se supabase-cores.sql ainda não correu, dá erro e fica a cor da categoria
      sb.from('perfis').select('user_id,cor')
    ]);
    cores = new Map((pf && !pf.error && pf.data ? pf.data : []).map((x) => [x.user_id, x.cor]));
    avisosMeus = new Map((av && !av.error && av.data ? av.data : []).map((a) => [a.registo_id, a.avisos_min || []]));
    modoConvidado = !!(conv && !conv.error && conv.data && conv.data.length);
    ocupados = [];
    if (modoConvidado) {
      const o = await sb.rpc('ocupado');
      ocupados = (o && !o.error && o.data) || [];
    }
    document.body.classList.toggle('modo-convidado', modoConvidado);
    if (r.error || p.error) {
      toast('Não foi possível carregar os dados. Verifique a ligação.');
      return;
    }
    reunioes = r.data || [];
    prazos = p.data || [];
    // Se a migração do calendário ainda não tiver corrido, a app funciona na mesma,
    // sem categorias e sem os campos novos, em vez de dar erro ao guardar.
    esquemaNovo = !!(c && !c.error);
    categorias = esquemaNovo ? (c.data || []) : [];
    document.body.classList.toggle('sem-calendario', !esquemaNovo);
    document.body.classList.toggle('tem-pessoal', categorias.some((c) => c.pessoal));
    if (modoConvidado && !$('#v-cal').classList.contains('active')) showTab('v-cal');
    renderAll();
  }

  function renderAll() {
    renderHoje();
    renderAlertas();
    atualizarBadge();
    renderCal();
    renderPrazos();
    renderCats();
    renderFact();
  }

  // ---------- cartões ----------
  function cardReuniao(m) {
    const futura = new Date(m.inicio).getTime() > Date.now();
    const pessoal = ehPessoal(m.categoria_id);
    // Confirmação e "realizada" são do registo original; as repetições só mostram e editam a série
    const pendente = !pessoal && !m._repeticao && m.estado === 'agendada' && futura && !m.confirmada;
    const serie = repete(m) ? ` · ↻ ${textoSerie(m)}` : '';
    const enviada = m.confirmacao_enviada_em
      ? `<span class="muted">Confirmação enviada em ${fmtDataHora(m.confirmacao_enviada_em)}</span>` : '';
    const cat = catDe(m, 'reuniao');
    return `
      <article class="card cat-borda" style="--cat:${esc(cat.cor)}">
        <div class="row">
          <strong>${esc(m.cliente)}</strong>
          <div class="card-chips">${avisoReuniaoAtivo(m) ? '<span class="chip urgente">Aviso</span>' : ''}${m.confirmada ? '<span class="chip ok">Confirmada</span>' : ''}<span class="chip ${esc(m.estado)}">${LABEL[m.estado] || esc(m.estado)}</span></div>
        </div>
        <div class="quando">${esc(textoQuando(m))}${pessoal ? '' : ' · ' + fmtEur(m.honorarios)}${m._parte ? ` <span class="parte">(dia ${m._parte.n} de ${m._parte.de})</span>` : ''}</div>
        <div class="cat-nome" style="--cat:${esc(cat.cor)}"><span class="cat-ponto" aria-hidden="true"></span>${esc(cat.nome)}${m.local ? ' · ' + esc(m.local) : ''}${esc(serie)}</div>
        ${m.topicos ? `<p>${esc(m.topicos)}</p>` : ''}
        ${enviada ? `<div style="margin-top:6px">${enviada}</div>` : ''}
        <div class="actions">
          ${pendente ? botoesConfirmar(m) : ''}
          ${pendente ? `<button class="btn small" data-confirmada="${m.id}">Confirmou</button>` : ''}
          ${!pessoal && !m._repeticao && m.estado === 'agendada' && !futura ? `<button class="btn small" data-realizar="${m.id}">Marcar realizada</button>` : ''}
          <button class="btn small" data-edit="${m.id}"${repete(m) ? ` data-ocorrencia="${dayKey(new Date(m.inicio))}"` : ''}>Editar</button>
        </div>
      </article>`;
  }

  // Um prazo tem aviso quando faltam exatamente os dias escolhidos, ou quando já passou (aviso diário)
  function avisoPrazoHoje(p) {
    if (p.concluido) return false;
    const dd = daysUntil(p.data_limite);
    return dd <= 0 || (p.avisos || []).includes(dd);
  }

  function prazoHtml(p) {
    const dd = daysUntil(p.data_limite);
    let estado;
    let cls = '';
    if (p.concluido) { estado = 'Concluído'; cls = 'done'; }
    else if (dd < 0) { estado = `Vencido há ${-dd} dia(s)`; cls = 'late'; }
    else if (dd === 0) { estado = 'Vence hoje'; cls = 'late'; }
    else if (dd <= 2) { estado = `Faltam ${dd} dia(s)`; cls = 'soon'; }
    else { estado = `Faltam ${dd} dia(s)`; }
    return `
      <article class="card prazo ${cls}">
        <div class="prazo-top">
          ${p._repeticao ? '' : `<input type="checkbox" class="prazo-check" data-toggle-prazo="${p.id}" ${p.concluido ? 'checked' : ''} aria-label="Concluído">`}
          <div class="prazo-info">
            <strong class="prazo-titulo">${esc(p.descricao)}</strong>
            <div class="muted">${esc(p.cliente || 'Sem cliente')}${repete(p) ? ' · ↻ ' + esc(REPETE[p.repetir] || '') : ''}</div>
          </div>
          <span class="chip ${cls}">${estado}</span>
        </div>
        <div class="prazo-foot">
          <span class="data-pill">${fmtDataSimples(p.data_limite)}</span>
          ${avisoPrazoHoje(p) ? '<span class="chip urgente">Aviso hoje</span>' : ''}
          <button class="btn small" data-edit-prazo="${p.id}">${repete(p) ? 'Editar série' : 'Editar'}</button>
        </div>
      </article>`;
  }

  // ---------- hoje ----------
  function renderHoje() {
    $('#hoje-data').textContent = new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
    const agora = Date.now();
    const confirmar = reunioes.filter((m) => {
      const t = new Date(m.inicio).getTime();
      return m.estado === 'agendada' && !m.confirmada && t > agora && t - agora <= 48 * HORA_MS;
    });
    $('#lista-confirmar').innerHTML = confirmar.length
      ? confirmar.map((m) => {
          const horas = Math.round((new Date(m.inicio).getTime() - agora) / HORA_MS);
          const urgente = horas <= 24 ? `<span class="chip urgente">Em ${horas} h</span>` : '';
          return `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)">
            <div><strong>${esc(m.cliente)}</strong> <span class="muted">· ${fmtDataHora(m.inicio)}</span></div>${urgente}
          </div>
          <div class="actions" style="margin:6px 0 12px">
            ${botoesConfirmar(m) || '<span class="muted">Sem contacto guardado</span>'}
            <button class="btn small" data-confirmada="${m.id}">Confirmou</button>
          </div>`;
        }).join('')
      : '<p class="empty">Não há confirmações pendentes nas próximas 48 horas.</p>';

    // Próximas: de cada registo que se repete, conta a próxima vez que acontece
    const hojeIni = startOfDay(new Date());
    const proximas = reunioes
      .filter((m) => m.estado === 'agendada')
      .map((m) => {
        if (!repete(m)) return new Date(m.fim || m.inicio) >= hojeIni ? m : null;
        const d = proximaOcorrencia(m, hojeIni);
        return d ? naData(m, d) : null;
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.inicio) - new Date(b.inicio))
      .slice(0, 5);
    $('#lista-proximas').innerHTML = proximas.length
      ? proximas.map(cardReuniao).join('')
      : '<p class="empty">Sem reuniões agendadas.</p>';

    const prazosProx = prazos.filter((p) => !p.concluido && daysUntil(p.data_limite) <= 7);
    $('#lista-prazos-hoje').innerHTML = prazosProx.length
      ? prazosProx.map(prazoHtml).join('')
      : '<p class="empty">Sem prazos a vencer nos próximos 7 dias.</p>';
  }

  // ---------- categorias ----------
  function catDe(item, tipo) {
    const c = categorias.find((k) => k.id === item.categoria_id);
    // Registo pessoal: na cor que quem o criou escolheu ("A minha cor"), se escolheu alguma
    const deQuem = c && c.pessoal && item.user_id ? cores.get(item.user_id) : null;
    if (deQuem) return { ...c, cor: deQuem };
    return c || (tipo === 'prazo' ? CAT_PRAZO : CAT_REUNIAO);
  }
  function ehPessoal(catId) {
    const c = categorias.find((k) => k.id === catId);
    return !!(c && c.pessoal);
  }
  // Num registo pessoal não há cliente nem honorários: o formulário adapta-se
  function aplicarModoPessoal(limpar) {
    const pessoal = ehPessoal($('#r-cat').value);
    $('#d-reuniao').classList.toggle('pessoal', pessoal);
    $('#lbl-cliente').textContent = pessoal ? 'Título' : 'Nome do cliente';
    $('#r-cliente').placeholder = pessoal ? 'ex.: Almoço, médico, ginásio' : '';
    $('#lbl-topicos').textContent = pessoal ? 'Notas' : 'Tópicos da reunião';
    $('#lbl-avisos').textContent = pessoal ? 'Avisar-me (só para mim)' : 'Avisar-me antes da reunião';
    $('#r-local').placeholder = pessoal ? 'ex.: casa, clínica, ginásio' : 'Escritório, tribunal ou videochamada';
    // Um registo pessoal não tem estado nem confirmação de cliente
    if (pessoal) { $('#r-estado').value = 'agendada'; $('#r-confirmada').checked = false; }
    // Só limpa quando é a utilizadora a mudar de categoria, nunca ao abrir um registo
    if (pessoal && limpar) { $('#r-telefone').value = ''; $('#r-email').value = ''; $('#r-honorarios').value = 0; }
  }

  function rgba(hex, a) {
    const h = String(hex || '#1f3160').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  // Tudo o que acontece num dia, reuniões e prazos juntos, por ordem de hora
  function itensDoDia(key) {
    const out = [];
    const dia = diaDeTexto(key);
    // Reuniões e "ocupado": no dia marcado e, se se repetem, em cada repetição
    // Eventos de vários dias aparecem em todos os dias que ocupam; dia todo fica no topo, sem hora
    const comHora = (lista, tipo) => lista.forEach((m) => {
      const o = ocorrenciaNoDia(m, dia);
      if (!o) return;
      const x = { ...naData(m, o.inicio) };
      if (o.dias > 1) x._parte = { n: o.parte + 1, de: o.dias };
      out.push({ tipo, dados: x, hora: x.dia_todo || o.parte > 0 ? null : new Date(x.inicio) });
    });
    comHora(reunioes, 'reuniao');
    comHora(ocupados, 'ocupado');
    // Um prazo que se repete mostra o atual e os seguintes; ao concluí-lo, passa para a próxima data
    prazos.forEach((p) => {
      if (p.data_limite === key) out.push({ tipo: 'prazo', dados: p, hora: null });
      else if (repete(p) && !p.concluido && ocorreEm(diaDeTexto(p.data_limite), p.repetir, dia)) out.push({ tipo: 'prazo', dados: { ...p, data_limite: key, _repeticao: true }, hora: null });
    });
    return out.sort((a, b) => (a.hora ? a.hora.getHours() * 60 + a.hora.getMinutes() : -1) - (b.hora ? b.hora.getHours() * 60 + b.hora.getMinutes() : -1));
  }

  // Trabalho da dona, visto pelo convidado: só a hora. Sem cliente, local nem assunto.
  function cardOcupado(o) {
    const h = (iso) => new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const quando = o.dia_todo || o._parte ? 'Dia todo' : h(o.inicio) + (o.fim ? ' – ' + h(o.fim) : '');
    return `<article class="card ocupado"><div class="row"><strong>Ocupado</strong></div><div class="muted">${esc(quando)}</div></article>`;
  }

  // ---------- calendário ----------
  function renderCal() {
    const first = new Date(mesCal.getFullYear(), mesCal.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // semana começa à segunda
    const start = new Date(first);
    start.setDate(1 - offset);
    const hoje = dayKey(new Date());
    const sel = dayKey(diaSel);

    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dayKey(d);
      const itens = itensDoDia(key);
      const cls = ['cal-day'];
      if (d.getMonth() !== mesCal.getMonth()) cls.push('out');
      if (key === hoje) cls.push('today');
      if (key === sel) cls.push('sel');

      const chips = itens.slice(0, 2).map((it) => {
        if (it.tipo === 'ocupado') return '<span class="chip-ev ocupado" style="--c-bg:transparent;--c-fg:#7b8499">Ocupado</span>';
        const c = catDe(it.dados, it.tipo);
        const prazo = it.tipo === 'prazo';
        const texto = prazo ? it.dados.descricao : it.dados.cliente;
        const feito = prazo && it.dados.concluido ? ' feito' : '';
        const todoDia = !prazo && (it.dados.dia_todo || it.dados._parte) ? ' todo-dia' : '';
        return `<span class="chip-ev${prazo ? ' lembrete' : ''}${feito}${todoDia}" style="--c-bg:${rgba(c.cor, 0.16)};--c-fg:${esc(c.cor)}">${esc(texto || 'Sem título')}</span>`;
      }).join('');
      const mais = itens.length > 2 ? `<span class="cal-mais">+${itens.length - 2}</span>` : '';

      const n = itens.length;
      const rotulo = `${d.getDate()} de ${d.toLocaleDateString('pt-PT', { month: 'long' })}${n ? `, ${n} ${n > 1 ? 'registos' : 'registo'}` : ', nada marcado'}`;
      cells += `<button class="${cls.join(' ')}" data-day="${key}" aria-label="${esc(rotulo)}"><span class="n">${d.getDate()}</span>${chips}${mais}</button>`;
    }
    $('#cal-grid').innerHTML = cells;
    $('#cal-titulo').textContent = mesCal.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
    if ($('#dpop').hasAttribute('open')) renderDPop();
  }

  // ---------- janela do dia ----------
  function renderDPop() {
    const key = dayKey(diaSel);
    const itens = itensDoDia(key);
    $('#dpop-tit').innerHTML = `${esc(diaSel.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' }))}<span class="sub">${itens.length ? itens.length + (itens.length > 1 ? ' registos' : ' registo') : 'Nada marcado'}</span>`;
    $('#dpop-lista').innerHTML = itens.length
      ? itens.map((it) => (it.tipo === 'prazo' ? prazoHtml(it.dados) : it.tipo === 'ocupado' ? cardOcupado(it.dados) : cardReuniao(it.dados))).join('')
      : '<p class="empty">Nada marcado neste dia.</p>';
  }
  function abrirDPop(key) {
    const [y, mo, d] = key.split('-').map(Number);
    diaSel = new Date(y, mo - 1, d);
    renderCal();
    renderDPop();
    $('#dpop').setAttribute('open', '');
  }
  function fecharDPop() { $('#dpop').removeAttribute('open'); }

  // ---------- prazos ----------
  function renderPrazos() {
    const ordenados = [...prazos].sort((a, b) => {
      if (a.concluido !== b.concluido) return a.concluido ? 1 : -1;
      return a.data_limite < b.data_limite ? -1 : 1;
    });
    $('#lista-prazos').innerHTML = ordenados.length
      ? ordenados.map(prazoHtml).join('')
      : '<p class="empty">Ainda não há prazos registados.</p>';
  }

  // ---------- faturação ----------
  function renderFact() {
    const [y, mNum] = $('#fact-mes').value.split('-').map(Number);
    if (!y || !mNum) return;
    const soma = (arr) => arr.reduce((s, r) => s + Number(r.honorarios || 0), 0);
    const doMes = reunioes.filter((r) => {
      const d = new Date(r.inicio);
      return d.getFullYear() === y && d.getMonth() === mNum - 1 && !ehPessoal(r.categoria_id);
    });
    const realizadas = doMes.filter((r) => r.estado === 'realizada');
    const agendadas = doMes.filter((r) => r.estado === 'agendada');

    $('#fact-mes-total').textContent = fmtEur(soma(realizadas));
    $('#fact-mes-n').textContent = `${realizadas.length} reunião(ões)`;
    $('#fact-prev').textContent = fmtEur(soma(agendadas));
    $('#fact-prev-n').textContent = `${agendadas.length} agendada(s)`;

    const anoRealizadas = reunioes.filter((r) => r.estado === 'realizada' && new Date(r.inicio).getFullYear() === y);
    $('#fact-ano-total').textContent = fmtEur(soma(anoRealizadas));
    const meses = Array.from({ length: 12 }, (_, i) =>
      soma(anoRealizadas.filter((r) => new Date(r.inicio).getMonth() === i)));
    const max = Math.max(1, ...meses);
    $('#fact-barras').innerHTML = meses.map((v, i) => `
      <div class="bar-row">
        <span style="text-transform:capitalize">${new Date(y, i, 1).toLocaleDateString('pt-PT', { month: 'short' })}</span>
        <div class="bar"><i style="width:${((v / max) * 100).toFixed(1)}%"></i></div>
        <b>${fmtEur(v)}</b>
      </div>`).join('');

    const lista = [...doMes].sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
    $('#fact-lista').innerHTML = lista.length
      ? lista.map((r) => `<div class="line"><span>${fmtDia(r.inicio)} · ${esc(r.cliente)} <span class="muted">(${LABEL[r.estado]})</span></span><b>${fmtEur(r.honorarios)}</b></div>`).join('')
      : '<p class="empty">Sem reuniões neste mês.</p>';
  }

  // ---------- categorias ----------
  function renderCats() {
    const el = $('#cats-lista');
    if (!el) return;
    if (!categorias.length) {
      el.innerHTML = '<p class="empty">Ainda não há categorias. Crie a primeira para dar cores ao calendário.</p>';
      return;
    }
    el.innerHTML = categorias.map((c) => `
      <div class="cat-linha">
        <span class="cat-dot" style="background:${esc(c.cor)}"></span>
        <span class="nome">${esc(c.nome)}</span>
        <button type="button" class="btn small" data-edit-cat="${esc(c.id)}">Editar</button>
      </div>`).join('');
  }

  function openCat(id) {
    const f = $('#f-cat');
    f.reset();
    const atual = id ? categorias.find((c) => c.id === id) : null;
    const cor = atual ? atual.cor : CORES[categorias.length % CORES.length];
    $('#c-cores').innerHTML = CORES.map((x) => `
      <button type="button" data-cor="${x}" style="background:${x}" aria-pressed="${x === cor}" aria-label="Cor ${x}"></button>`).join('');
    // Uma categoria com registos não muda entre trabalho e pessoal: passar a pessoal
    // mostraria aos convidados os clientes, contactos e honorários que lá estão.
    // A base de dados recusa a mudança (supabase-categorias-seguras.sql); aqui só se explica.
    const usada = atual ? reunioes.filter((m) => m.categoria_id === atual.id).length + prazos.filter((p) => p.categoria_id === atual.id).length : 0;
    $('#c-pessoal').disabled = usada > 0;
    $('#c-pessoal-ajuda').textContent = usada > 0
      ? `Já tem ${usada} ${usada > 1 ? 'registos' : 'registo'}, por isso não pode mudar entre trabalho e pessoal. Para separar, crie uma categoria nova e mude lá os registos.`
      : 'Esconde o cliente e os honorários, fica de fora da faturação e é partilhada com os convidados.';
    if (atual) {
      $('#c-id').value = atual.id;
      $('#c-nome').value = atual.nome;
      $('#c-pessoal').checked = !!atual.pessoal;
      $('#d-cat-titulo').textContent = 'Editar categoria';
      $('#c-apagar').hidden = false;
    } else {
      $('#c-id').value = '';
      $('#c-pessoal').checked = false;
      $('#d-cat-titulo').textContent = 'Nova categoria';
      $('#c-apagar').hidden = true;
    }
    $('#d-cat').showModal();
  }

  function corEscolhida(caixa = '#c-cores') {
    const b = $(caixa + ' button[aria-pressed="true"]');
    return b ? b.dataset.cor : CORES[0];
  }

  // ---------- a minha cor ----------
  const corDaCategoriaPessoal = () => (categorias.find((c) => c.pessoal) || { cor: CORES[4] }).cor;
  function mostrarExemploCor() {
    const cor = corEscolhida('#cor-cores');
    $('#cor-exemplo-faixa').style.setProperty('--c-fg', cor);
    $('#cor-exemplo-cartao').style.setProperty('--cor', cor);
  }
  function openMinhaCor() {
    const atual = cores.get(user.id) || corDaCategoriaPessoal();
    const lista = CORES.includes(atual) ? CORES : CORES.concat([atual]);
    $('#cor-cores').innerHTML = lista.map((x) => `
      <button type="button" data-cor="${esc(x)}" style="background:${esc(x)}" aria-pressed="${x === atual}" aria-label="Cor ${esc(x)}"></button>`).join('');
    $('#cor-repor').hidden = !cores.has(user.id);
    mostrarExemploCor();
    $('#d-cor').showModal();
  }
  const semTabelaPerfis = (err) => /perfis/.test(err.message || '');
  $('#f-cor').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await sb.from('perfis').upsert({ user_id: user.id, cor: corEscolhida('#cor-cores'), atualizado_em: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) { toast(semTabelaPerfis(error) ? 'Esta opção ainda não está ativa no servidor.' : 'Erro: ' + error.message); return; }
    $('#d-cor').close();
    toast('Cor guardada');
    await loadAll();
  });
  $('#cor-repor').addEventListener('click', async () => {
    const { error } = await sb.from('perfis').delete().eq('user_id', user.id);
    if (error) { toast('Erro: ' + error.message); return; }
    $('#d-cor').close();
    toast('Volta a usar a cor da categoria');
    await loadAll();
  });

  // ---------- confirmação com 1 toque ----------
  function textoConfirmacao(m) {
    const d = new Date(m.inicio);
    const data = d.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
    const hora = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    return `Exmo(a). Sr(a). ${m.cliente},\n\n` +
      `Pedimos a confirmação da nossa reunião para ${data}, às ${hora}.\n\n` +
      `Por favor, responda a esta mensagem para confirmar a sua presença. ` +
      `Se precisar de remarcar, avise-nos com a maior antecedência possível.\n\n` +
      `Com os melhores cumprimentos,\n${cfg.ASSINATURA || 'Prolegal Solutions'}`;
  }

  function botoesConfirmar(m) {
    let h = '';
    if (m.telefone) h += `<button class="btn small gold" data-confirm="${m.id}" data-canal="whatsapp">Enviar por WhatsApp</button>`;
    if (m.email) h += `<button class="btn small gold" data-confirm="${m.id}" data-canal="email">Enviar por e-mail</button>`;
    return h;
  }

  async function enviarConfirmacao(id, canal) {
    const m = reunioes.find((x) => x.id === id);
    if (!m) return;
    const texto = textoConfirmacao(m);

    let url;
    if (canal === 'email') {
      if (!m.email) { toast('Esta reunião não tem e-mail guardado.'); return; }
      url = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent('Confirmação de reunião')}&body=${encodeURIComponent(texto)}`;
    } else {
      if (!m.telefone) { toast('Esta reunião não tem telemóvel guardado.'); return; }
      let digits = m.telefone.replace(/\D/g, '');
      if (digits.length === 9) digits = '351' + digits; // número português sem indicativo
      url = `https://wa.me/${digits}?text=${encodeURIComponent(texto)}`;
    }

    // Abrir primeiro (dentro do toque do utilizador), para o browser não bloquear o pop-up
    if (url.startsWith('mailto:')) window.location.href = url;
    else window.open(url, '_blank', 'noopener');

    // Depois registar que a mensagem foi preparada. A confirmação real do cliente é marcada à parte.
    const agora = new Date().toISOString();
    const { error } = await sb.from('reunioes').update({ confirmacao_enviada_em: agora }).eq('id', id);
    if (error) toast('Não foi possível registar o envio.');
    await loadAll();
  }

  // ---------- ações ----------
  async function atualizarReuniao(id, changes, msg) {
    const { error } = await sb.from('reunioes').update(changes).eq('id', id);
    if (error) { toast('Erro: ' + error.message); return; }
    if (msg) toast(msg);
    await loadAll();
  }

  async function togglePrazo(id, concluido) {
    // Concluir um prazo que se repete não o arquiva: passa para a próxima data da série
    const p = prazos.find((x) => x.id === id);
    if (concluido && repete(p)) {
      const atual = diaDeTexto(p.data_limite);
      const prox = proximaData(atual, p.repetir, new Date(atual.getFullYear(), atual.getMonth(), atual.getDate() + 1));
      if (prox) {
        const { error } = await sb.from('prazos').update({ data_limite: dayKey(prox) }).eq('id', id);
        if (error) toast('Erro: ' + error.message);
        else toast(`Concluído. Próximo: ${fmtDataSimples(dayKey(prox))}`);
        await loadAll();
        return;
      }
    }
    const { error } = await sb.from('prazos').update({ concluido }).eq('id', id);
    if (error) toast('Erro: ' + error.message);
    await loadAll();
  }

  function openReuniao(id, dia, pessoal, ocorrencia) {
    const f = $('#f-reuniao');
    f.reset();
    // As datas voltam a ter hora; "Dia todo" (aplicarDiaTodo) tira-a outra vez se for o caso
    ['#r-inicio', '#r-fim'].forEach((sel) => { $(sel).type = 'datetime-local'; delete $(sel).dataset.hora; });
    $('#r-ocorrencia').value = '';
    if (id) {
      const m0 = reunioes.find((x) => x.id === id);
      if (!m0) return;
      // Aberto a partir de uma repetição: mostra as datas desse dia (como no calendário da Apple)
      const m = ocorrencia && repete(m0) ? naData(m0, diaDeTexto(ocorrencia)) : m0;
      if (ocorrencia && repete(m0)) $('#r-ocorrencia').value = ocorrencia;
      $('#r-id').value = m.id;
      $('#r-cliente').value = m.cliente || '';
      $('#r-telefone').value = m.telefone || '';
      $('#r-email').value = m.email || '';
      $('#r-inicio').value = toLocalInput(m.inicio);
      $('#r-fim').value = m.fim ? toLocalInput(m.fim) : '';
      $('#r-diatodo').checked = !!m.dia_todo;
      $('#r-local').value = m.local || '';
      $('#r-repetir').value = m.repetir || 'nunca';
      $('#r-ate-modo').value = m.repetir_ate ? 'data' : 'nunca';
      $('#r-ate').value = m.repetir_ate || '';
      setDiasSemana(m.dias_semana || []);
      encherCats('#r-cat', m.categoria_id, 'Reunião');
      aplicarModoPessoal();
      $('#r-honorarios').value = m.honorarios ?? 0;
      $('#r-topicos').value = m.topicos || '';
      $('#r-estado').value = m.estado;
      $('#r-confirmada').checked = !!m.confirmada;
      setAvisosR(avisosDe(m), m.dia_todo);
      aplicarDiaTodo(false);
      $('#d-reuniao-titulo').textContent = ehPessoal(m.categoria_id) ? 'Editar registo pessoal' : 'Editar reunião';
      $('#r-apagar').hidden = false;
    } else {
      $('#r-id').value = '';
      $('#d-reuniao-titulo').textContent = pessoal ? 'Novo registo pessoal' : 'Nova reunião';
      $('#r-apagar').hidden = true;
      const base = dia ? new Date(dia) : new Date();
      if (dia) base.setHours(10, 0, 0, 0);
      else { base.setSeconds(0, 0); base.setHours(base.getHours() + 1, 0, 0, 0); }
      $('#r-inicio').value = toLocalInput(base);
      const fim = new Date(base); fim.setHours(fim.getHours() + 1);
      $('#r-fim').value = toLocalInput(fim);
      $('#r-diatodo').checked = false;
      $('#r-local').value = '';
      $('#r-repetir').value = 'nunca';
      $('#r-ate-modo').value = 'nunca';
      $('#r-ate').value = '';
      setDiasSemana([]);
      const cp = pessoal ? categorias.find((c) => c.pessoal) : null;
      encherCats('#r-cat', cp ? cp.id : null, 'Reunião');
      aplicarModoPessoal();
      setAvisosR([1440, 120]);
      aplicarDiaTodo(false);
    }
    $('#d-reuniao').showModal();
  }

  // ---------- dias da semana de uma repetição ----------
  const caixasDias = () => Array.from(document.querySelectorAll('input[name=diaSem]'));
  const diasMarcados = () => caixasDias().filter((i) => i.checked).map((i) => Number(i.value));
  const diaDoInicio = () => { const v = $('#r-inicio').value; return v ? diaIso(diaDeTexto(v.slice(0, 10))) : null; };
  function setDiasSemana(lista) {
    caixasDias().forEach((i) => { i.checked = lista.includes(Number(i.value)); });
    mostrarDiasSemana();
  }
  // Só aparece em "todas as semanas" e "de 15 em 15 dias"; abre com o dia do início marcado
  function mostrarDiasSemana() {
    const r = $('#r-repetir').value;
    const semanal = r === 'semanal' || r === 'quinzenal';
    $('#r-dias').hidden = !semanal;
    // "Terminar repetição: Nunca / Numa data" só faz sentido quando repete
    $('#r-fim-rep').hidden = r === 'nunca';
    $('#r-ate').hidden = $('#r-ate-modo').value !== 'data';
    if (semanal && !diasMarcados().length && diaDoInicio()) setDiasSemanaSoVisual([diaDoInicio()]);
  }
  // Dia todo: as datas deixam de ter hora e os avisos passam a ser "no dia / dias antes, às 9:00"
  function aplicarDiaTodo(peloUtilizador) {
    const todo = $('#r-diatodo').checked;
    ['#r-inicio', '#r-fim'].forEach((sel, i) => {
      const el = $(sel);
      const v = el.value;
      if (todo && el.type !== 'date') { el.dataset.hora = v.slice(11, 16); el.type = 'date'; el.value = v.slice(0, 10); }
      else if (!todo && el.type !== 'datetime-local') { el.type = 'datetime-local'; el.value = v ? `${v}T${el.dataset.hora || (i ? '11:00' : '10:00')}` : ''; }
    });
    // Ao ligar "Dia todo", o fim passa a ser o mesmo dia (um só dia), salvo se já for depois
    if (todo && peloUtilizador && (!$('#r-fim').value || $('#r-fim').value < $('#r-inicio').value)) $('#r-fim').value = $('#r-inicio').value;
    $('#lbl-inicio').textContent = todo ? 'Início' : 'Data e hora';
    $('#avisos-hora').hidden = todo;
    $('#avisos-dia-todo').hidden = !todo;
    if (todo && peloUtilizador && !document.querySelector('input[name=avisoD]:checked')) document.querySelector('input[name=avisoD][value="0"]').checked = true;
  }
  const lerAvisos = () => Array.from(document.querySelectorAll(`input[name=${$('#r-diatodo').checked ? 'avisoD' : 'avisoR'}]:checked`)).map((i) => Number(i.value));

  // "Só este evento" / "Este e os seguintes" (devolve 'este', 'seguintes' ou '' se cancelar)
  function perguntarSerie(acao, primeiro) {
    const d = $('#d-serie');
    $('#d-serie-titulo').textContent = acao === 'apagar' ? 'Apagar evento' : 'Guardar alterações';
    $('#d-serie-texto').textContent = acao === 'apagar'
      ? 'Este evento repete-se. Quer apagar só este dia, ou também todos os seguintes?'
      : 'Este evento repete-se. Quer aplicar as alterações só a este dia, ou a este e a todos os seguintes?';
    $('#d-serie-este').textContent = acao === 'apagar' ? 'Apagar só este evento' : 'Só este evento';
    $('#d-serie-seguintes').textContent = acao === 'apagar' ? (primeiro ? 'Apagar todos' : 'Apagar este e os seguintes') : (primeiro ? 'Todos os eventos' : 'Este e os seguintes');
    $('#d-serie-este').className = 'btn ' + (acao === 'apagar' ? 'danger' : 'primary');
    $('#d-serie-seguintes').className = 'btn' + (acao === 'apagar' ? ' danger' : '');
    d.returnValue = '';
    return new Promise((resolve) => {
      d.addEventListener('close', () => resolve(d.returnValue || ''), { once: true });
      d.showModal();
    });
  }

  function setDiasSemanaSoVisual(lista) { caixasDias().forEach((i) => { i.checked = lista.includes(Number(i.value)); }); }

  function encherCats(sel, escolhida, omissao) {
    const el = $(sel);
    const lista = categorias.length ? categorias : [{ id: '', nome: omissao }];
    el.innerHTML = lista.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
    if (escolhida) el.value = escolhida;
    else if (categorias.length) {
      const pref = categorias.find((c) => c.nome === omissao);
      el.value = pref ? pref.id : categorias[0].id;
    }
  }

  function setAvisos(lista) {
    document.querySelectorAll('input[name=aviso]').forEach((i) => { i.checked = lista.includes(Number(i.value)); });
  }

  function openPrazo(id, dia) {
    $('#f-prazo').reset();
    if (id) {
      const p = prazos.find((x) => x.id === id);
      if (!p) return;
      $('#p-id').value = p.id;
      $('#p-descricao').value = p.descricao;
      $('#p-cliente').value = p.cliente || '';
      $('#p-data').value = p.data_limite;
      $('#p-hora').value = p.hora ? String(p.hora).slice(0, 5) : '';
      $('#p-local').value = p.local || '';
      $('#p-repetir').value = p.repetir || 'nunca';
      encherCats('#p-cat', p.categoria_id, 'Prazo');
      setAvisos(p.avisos || [3, 1, 0]);
      $('#d-prazo-titulo').textContent = 'Editar prazo';
      $('#p-apagar').hidden = false;
    } else {
      $('#p-id').value = '';
      $('#p-data').value = dayKey(dia || new Date());
      $('#p-hora').value = '';
      $('#p-local').value = '';
      $('#p-repetir').value = 'nunca';
      encherCats('#p-cat', null, 'Prazo');
      setAvisos([3, 1, 0]);
      $('#d-prazo-titulo').textContent = 'Novo prazo';
      $('#p-apagar').hidden = true;
    }
    $('#d-prazo').showModal();
  }

  function showTab(id) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === id));
    $$('.drawer button[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    toggleMenu(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toggleMenu(open) {
    $('#menu').hidden = !open;
    $('#menu-overlay').hidden = !open;
    $('[data-menu]').setAttribute('aria-expanded', String(open));
  }

  // ---------- avisos das reuniões ----------
  // Os avisos de dia todo e os de hora são conjuntos diferentes: só se marca o do tipo do registo
  function setAvisosR(lista, diaTodo) {
    document.querySelectorAll('input[name=avisoR]').forEach((i) => { i.checked = !diaTodo && lista.includes(Number(i.value)); });
    document.querySelectorAll('input[name=avisoD]').forEach((i) => { i.checked = !!diaTodo && lista.includes(Number(i.value)); });
  }

  // Uma reunião tem aviso ativo quando já chegou a hora de algum dos avisos escolhidos e ainda não passou
  function avisoReuniaoAtivo(m) {
    if (m.estado !== 'agendada' || m.confirmada) return false;
    // Dia todo: os avisos são contados a partir das 9:00 desse dia (como no calendário da Apple)
    const base = new Date(m.inicio);
    if (m.dia_todo) base.setHours(9, 0, 0, 0);
    const t = base.getTime();
    const agora = Date.now();
    return t > agora && avisosDe(m).some((min) => agora >= t - min * 60000);
  }
  // Lembretes de quem está a usar a app: nos registos que criou, os do próprio registo;
  // nos que o outro criou (pessoais partilhados), os seus, guardados à parte.
  function avisosDe(m) {
    return !user || m.user_id === user.id ? (m.avisos_min || []) : (avisosMeus.get(m.id) || []);
  }

  // ---------- alertas (número no ícone) ----------
  function isInstalada() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  // ---------- alertas no telemóvel ----------
  const VAPID = 'BLEUYbAp_YlD1VJEyySs9U-O1DjVD85t37vQFkH1zpS9rQ8aPGJRyBr_laMKVlJbOmiF6sJom7EENbhJtt3iCOE';

  function suportaPush() {
    return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  }
  function b64ParaBytes(b64) {
    const t = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  }

  // navigator.serviceWorker.ready nunca resolve se o registo falhar, por isso há um limite
  function comLimite(promessa, ms) {
    return Promise.race([promessa, new Promise((r) => setTimeout(() => r(null), ms))]);
  }
  function ehIOS() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  async function guardarSub(sub) {
    const j = sub.toJSON();
    const { error } = await sb.from('push_subs').upsert(
      { user_id: user.id, endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ultimo_erro: null },
      { onConflict: 'endpoint' }
    );
    return !error;
  }

  // Os alertas estão sempre ligados: sempre que a app abre, confirma em silêncio que este
  // telemóvel está registado (e regista-o outra vez se for preciso). A única coisa que não
  // pode ser automática é a primeira autorização: a Apple exige um toque da pessoa.
  let alertasOk = false;
  let sincEmCurso = null;
  function sincronizarAlertas() {
    if (!user || !suportaPush() || Notification.permission !== 'granted') return Promise.resolve(false);
    if (!sincEmCurso) {
      sincEmCurso = (async () => {
        try {
          const reg = await comLimite(navigator.serviceWorker.ready, 8000);
          if (!reg) return false;
          const sub = (await reg.pushManager.getSubscription())
            || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ParaBytes(VAPID) }));
          return await guardarSub(sub);
        } catch (e) { return false; }
      })().finally(() => { sincEmCurso = null; });
    }
    return sincEmCurso;
  }

  async function ligarAlertas() {
    const btn = $('#btn-alertas');
    btn.disabled = true;
    try {
      const permissao = await Notification.requestPermission();
      if (permissao === 'granted') {
        alertasOk = await sincronizarAlertas();
        toast(alertasOk ? 'Alertas ligados neste telemóvel' : 'Não foi possível ligar os alertas. Tente outra vez.');
      }
    } catch (e) {
      toast('Não foi possível ligar os alertas.');
    }
    btn.disabled = false;
    renderAlertas();
  }

  // Ao sair, este telemóvel deixa de receber os alertas desta conta
  // (se a app passar para outra pessoa, não lhe chegam nomes de clientes de outra conta).
  async function esquecerTelemovel() {
    try {
      if (!suportaPush()) return;
      const reg = await comLimite(navigator.serviceWorker.ready, 2000);
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await sb.from('push_subs').delete().eq('endpoint', sub.endpoint);
    } catch (e) { /* sair nunca fica bloqueado por isto */ }
  }

  // Aviso no topo da app. Só aparece quando falta alguma coisa; com tudo ligado, não se vê nada.
  async function renderAlertas() {
    const aviso = $('#alertas-aviso');
    if (!aviso) return;
    const texto = $('#alertas-texto'), btn = $('#btn-alertas');
    const mostrar = (msg, comBotao) => { texto.textContent = msg; btn.hidden = !comBotao; aviso.hidden = false; };
    aviso.hidden = true;

    if (ehIOS() && !isInstalada()) {
      return mostrar('Para receber alertas, adicione a app ao ecrã principal (Partilhar → Adicionar ao ecrã principal) e abra-a por esse ícone.', false);
    }
    if (!suportaPush()) return;
    if (Notification.permission === 'denied') {
      return mostrar('Os alertas estão bloqueados neste telemóvel. Para os ligar: Definições → Notificações → Prolegal Solutions.', false);
    }
    if (Notification.permission === 'default') {
      return mostrar('Para receber aviso antes de cada reunião e prazo, mesmo com a app fechada, toque em “Permitir alertas”. Só é pedido uma vez.', true);
    }
    if (!alertasOk) alertasOk = await sincronizarAlertas();
    if (!alertasOk) mostrar('Não foi possível ligar os alertas neste telemóvel.', true);
  }

  // O número no ícone mostra as notificações por ver (é o service worker que o põe quando
  // chega um alerta). Abrir a app conta como vê-las: limpa as notificações e o número.
  async function atualizarBadge() {
    try {
      const reg = 'serviceWorker' in navigator ? await comLimite(navigator.serviceWorker.ready, 2000) : null;
      if (reg && reg.getNotifications) (await reg.getNotifications()).forEach((n) => n.close());
    } catch (e) { /* sem service worker não há notificações a limpar */ }
    if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {});
  }


  // ---------- eventos ----------
  let tapTimer = null;
  let tapDia = null;
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('button, [data-day]');
    if (!el) return;

    if (el.id === 'btn-alertas') return ligarAlertas();
    if ('menu' in el.dataset) return toggleMenu(true);
    if ('closeMenu' in el.dataset) return toggleMenu(false);
    if (el.dataset.tab) return showTab(el.dataset.tab);
    if (el.dataset.mes) {
      mesCal = new Date(mesCal.getFullYear(), mesCal.getMonth() + Number(el.dataset.mes), 1);
      return renderCal();
    }
    if (el.dataset.day) {
      // Um toque abre o dia. Dois toques marcam já nesse dia.
      const key = el.dataset.day;
      if (tapTimer && tapDia === key) {
        clearTimeout(tapTimer); tapTimer = null; tapDia = null;
        const [y, mo, d] = key.split('-').map(Number);
        diaSel = new Date(y, mo - 1, d);
        fecharDPop();
        renderCal();
        return openReuniao(null, diaSel, modoConvidado);
      }
      clearTimeout(tapTimer);
      tapDia = key;
      tapTimer = setTimeout(() => { tapTimer = null; tapDia = null; abrirDPop(key); }, 260);
      return;
    }
    if ('fecharDpop' in el.dataset) return fecharDPop();
    if ('dpopReuniao' in el.dataset) { fecharDPop(); return openReuniao(null, diaSel); }
    if ('dpopPrazo' in el.dataset) { fecharDPop(); return openPrazo(null, diaSel); }
    if ('dpopPessoal' in el.dataset) { fecharDPop(); return openReuniao(null, diaSel, true); }
    if ('minhaCor' in el.dataset) { toggleMenu(false); return openMinhaCor(); }
    if ('novaCat' in el.dataset) return openCat(null);
    if (el.dataset.editCat) return openCat(el.dataset.editCat);
    if ('novaReuniao' in el.dataset) return openReuniao(null, null);
    if ('novoDia' in el.dataset) return openReuniao(null, diaSel);
    if (el.dataset.edit) return openReuniao(el.dataset.edit, null, false, el.dataset.ocorrencia);
    if (el.dataset.confirm) return enviarConfirmacao(el.dataset.confirm, el.dataset.canal);
    if (el.dataset.confirmada) return atualizarReuniao(el.dataset.confirmada, { confirmada: true }, 'Marcada como confirmada');
    if (el.dataset.realizar) return atualizarReuniao(el.dataset.realizar, { estado: 'realizada' }, 'Reunião marcada como realizada');
    if ('novoPrazo' in el.dataset) return openPrazo(null);
    if (el.dataset.editPrazo) return openPrazo(el.dataset.editPrazo);
    if ('close' in el.dataset) return el.closest('dialog').close();
    if ('logout' in el.dataset) {
      // Antes de sair: este telemóvel deixa de receber os alertas desta conta.
      await esquecerTelemovel();
      alertasOk = false;
      modoConvidado = false; ocupados = [];
      document.body.classList.remove('modo-convidado');
      await sb.auth.signOut();
      return;
    }
  });

  // Escolher uma cor (na categoria ou em "A minha cor")
  ['c-cores', 'cor-cores'].forEach((idCaixa) => document.getElementById(idCaixa).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cor]');
    if (!b) return;
    $$('#' + idCaixa + ' button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (idCaixa === 'cor-cores') mostrarExemploCor();
  }));

  document.getElementById('dpop').addEventListener('click', (e) => {
    if (e.target.classList.contains('fundo')) fecharDPop();
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'r-cat') aplicarModoPessoal(true);
    if (e.target.id === 'r-repetir' || e.target.id === 'r-ate-modo') mostrarDiasSemana();
    if (e.target.id === 'r-diatodo') aplicarDiaTodo(true);
    // Mudar a data com um só dia marcado leva esse dia atrás (ex.: passar de segunda para terça)
    if (e.target.id === 'r-inicio' && !$('#r-dias').hidden && diasMarcados().length <= 1 && diaDoInicio()) setDiasSemanaSoVisual([diaDoInicio()]);
    if (e.target.dataset.togglePrazo) togglePrazo(e.target.dataset.togglePrazo, e.target.checked);
    if (e.target.id === 'fact-mes') renderFact();
  });

  $('#f-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({
      email: $('#l-email').value.trim(),
      password: $('#l-pass').value
    });
    if (error) toast('E-mail ou palavra-passe inválidos.');
    else $('#l-pass').value = '';
  });

  $('#f-reuniao').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#r-id').value;
    const orig = id ? reunioes.find((x) => x.id === id) : null;
    const todo = $('#r-diatodo').checked;
    const vIni = $('#r-inicio').value;
    const vFim = $('#r-fim').value;
    if (!vIni) { toast(todo ? 'Indique o dia.' : 'Indique a data e a hora.'); return; }
    // Dia todo guarda-se à meia-noite do primeiro e do último dia (o último conta inteiro)
    const ini = todo ? diaDeTexto(vIni.slice(0, 10)) : new Date(vIni);
    let fim = vFim ? (todo ? diaDeTexto(vFim.slice(0, 10)) : new Date(vFim)) : null;
    if (fim && fim < ini) fim = todo ? new Date(ini) : null;
    const payload = {
      cliente: $('#r-cliente').value.trim(),
      telefone: $('#r-telefone').value.trim() || null,
      email: $('#r-email').value.trim() || null,
      inicio: ini.toISOString(),
      honorarios: Number($('#r-honorarios').value) || 0,
      topicos: $('#r-topicos').value.trim() || null,
      estado: $('#r-estado').value,
      confirmada: $('#r-confirmada').checked,
      avisos_min: lerAvisos()
    };
    if (esquemaNovo) {
      payload.fim = fim ? fim.toISOString() : null;
      payload.dia_todo = todo;
      payload.local = $('#r-local').value.trim() || null;
      payload.repetir = $('#r-repetir').value;
      payload.categoria_id = $('#r-cat').value || null;
      // Dias da semana: só em "todas as semanas" / "de 15 em 15 dias"
      const dias = diasDaSerie(payload.repetir, diasMarcados());
      if (dias || (orig && 'dias_semana' in orig)) payload.dias_semana = dias;
      // Terminar repetição: "Nunca" ou o último dia escolhido
      const ate = payload.repetir !== 'nunca' && $('#r-ate-modo').value === 'data' && $('#r-ate').value ? $('#r-ate').value : null;
      if (ate || (orig && 'repetir_ate' in orig)) payload.repetir_ate = ate;
    }
    const ocorr = $('#r-ocorrencia').value;
    // Se a data mudou (remarcação), a confirmação anterior deixa de valer
    const antes = orig ? (ocorr && repete(orig) ? naData(orig, diaDeTexto(ocorr)).inicio : orig.inicio) : null;
    if (orig && new Date(antes).getTime() !== ini.getTime()) {
      payload.confirmada = false;
      payload.confirmacao_enviada_em = null;
    }
    // Num registo criado pelo outro, os lembretes escolhidos são só meus: não mexem nos dele.
    const doOutro = !!orig && orig.user_id !== user.id;
    const meus = payload.avisos_min;
    if (doOutro) delete payload.avisos_min;

    // Grava; se a base de dados ainda não tiver uma coluna nova, grava sem ela em vez de falhar
    const OPCIONAIS = ['dias_semana', 'repetir_ate', 'excecoes'];
    let faltou = false;
    async function gravar(fn, p) {
      let r = await fn(p);
      if (r.error && OPCIONAIS.some((c) => c in p && r.error.message.includes(c))) {
        OPCIONAIS.forEach((c) => delete p[c]);
        faltou = true;
        r = await fn(p);
      }
      return r;
    }
    const inserir = (p) => sb.from('reunioes').insert({ ...p, user_id: user.id }).select('id').single();
    const atualizar = (p) => sb.from('reunioes').update(p).eq('id', id);

    // Série aberta num dia concreto: pergunta "só este evento / este e os seguintes"
    if (orig && repete(orig) && ocorr) {
      const primeiro = ocorr === dayKey(new Date(orig.inicio));
      const escolha = await perguntarSerie('guardar', primeiro);
      if (!escolha) return;
      if (escolha === 'este' || !primeiro) {
        // Cria o registo novo (só este dia, ou a série a partir daqui) e corta o antigo
        const novo = escolha === 'este' ? { ...payload, repetir: 'nunca', dias_semana: null, repetir_ate: null } : { ...payload };
        if (doOutro) novo.avisos_min = meus;
        const r1 = await gravar(inserir, novo);
        if (r1.error) { toast('Erro: ' + r1.error.message); return; }
        const corte = escolha === 'este' ? { excecoes: [...(orig.excecoes || []), ocorr] } : { repetir_ate: diaAnterior(ocorr) };
        const r2 = await atualizar(corte);
        if (r2.error) {
          await sb.from('reunioes').delete().eq('id', r1.data.id);
          toast(/excecoes|repetir_ate/.test(r2.error.message) ? 'Esta opção ainda não está ativa no servidor.' : 'Erro: ' + r2.error.message);
          return;
        }
        $('#d-reuniao').close();
        toast(escolha === 'este' ? 'Alterado só neste dia' : 'Alterado a partir deste dia');
        await loadAll();
        return;
      }
      // "Todos os eventos" a partir do primeiro dia: muda a série inteira (segue abaixo)
    }

    const res = await gravar(orig ? atualizar : inserir, payload);
    if (res.error) { toast('Erro: ' + res.error.message); return; }
    if (faltou) toast('Guardado, mas algumas opções ainda não estão ativas no servidor.');
    if (doOutro) {
      const a = await sb.from('avisos_meus').upsert({ registo_id: id, user_id: user.id, avisos_min: meus }, { onConflict: 'registo_id,user_id' });
      if (a.error) toast('Guardado, mas os seus lembretes não: ' + a.error.message);
    }
    $('#d-reuniao').close();
    if (!faltou) toast(ehPessoal(payload.categoria_id) ? 'Guardado' : 'Reunião guardada');
    await loadAll();
  });

  $('#r-apagar').addEventListener('click', async () => {
    const id = $('#r-id').value;
    if (!id) return;
    const orig = reunioes.find((x) => x.id === id);
    const ocorr = $('#r-ocorrencia').value;
    let res;
    let msg = orig && ehPessoal(orig.categoria_id) ? 'Apagado' : 'Reunião apagada';
    if (orig && repete(orig) && ocorr) {
      // Como no calendário da Apple: só este dia, ou este e os seguintes (ou todos, no primeiro dia)
      const primeiro = ocorr === dayKey(new Date(orig.inicio));
      const escolha = await perguntarSerie('apagar', primeiro);
      if (!escolha) return;
      if (escolha === 'este') { res = await sb.from('reunioes').update({ excecoes: [...(orig.excecoes || []), ocorr] }).eq('id', id); msg = 'Apagado só neste dia'; }
      else if (primeiro) res = await sb.from('reunioes').delete().eq('id', id);
      else { res = await sb.from('reunioes').update({ repetir_ate: diaAnterior(ocorr) }).eq('id', id); msg = 'Apagado a partir deste dia'; }
    } else {
      if (!confirm(orig && ehPessoal(orig.categoria_id) ? 'Apagar este registo?' : 'Apagar esta reunião?')) return;
      res = await sb.from('reunioes').delete().eq('id', id);
    }
    if (res.error) { toast(/excecoes|repetir_ate/.test(res.error.message) ? 'Esta opção ainda não está ativa no servidor.' : 'Erro: ' + res.error.message); return; }
    $('#d-reuniao').close();
    toast(msg);
    await loadAll();
  });

  $('#f-prazo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#p-id').value;
    const payload = {
      descricao: $('#p-descricao').value.trim(),
      cliente: $('#p-cliente').value.trim() || null,
      data_limite: $('#p-data').value,
      avisos: Array.from(document.querySelectorAll('input[name=aviso]:checked')).map((i) => Number(i.value))
    };
    if (esquemaNovo) {
      payload.hora = $('#p-hora').value || null;
      payload.local = $('#p-local').value.trim() || null;
      payload.repetir = $('#p-repetir').value;
      payload.categoria_id = $('#p-cat').value || null;
    }
    const res = id
      ? await sb.from('prazos').update(payload).eq('id', id)
      : await sb.from('prazos').insert({ ...payload, user_id: user.id });
    if (res.error) { toast('Erro: ' + res.error.message); return; }
    $('#d-prazo').close();
    toast('Prazo guardado');
    await loadAll();
  });

  $('#f-cat').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#c-id').value;
    const payload = { nome: $('#c-nome').value.trim(), cor: corEscolhida(), pessoal: $('#c-pessoal').checked };
    if (!payload.nome) { toast('Indique o nome.'); return; }
    const res = id
      ? await sb.from('categorias').update(payload).eq('id', id)
      : await sb.from('categorias').insert({ ...payload, user_id: user.id, ordem: categorias.length + 1 });
    if (res.error) { toast('Erro: ' + res.error.message); return; }
    $('#d-cat').close();
    toast('Categoria guardada');
    await loadAll();
  });

  $('#c-apagar').addEventListener('click', async () => {
    const id = $('#c-id').value;
    const usada = reunioes.filter((m) => m.categoria_id === id).length + prazos.filter((p) => p.categoria_id === id).length;
    const aviso = usada
      ? `Apagar esta categoria? ${usada} ${usada > 1 ? 'registos ficam' : 'registo fica'} sem categoria, mas nada é apagado.`
      : 'Apagar esta categoria?';
    if (!confirm(aviso)) return;
    const { error } = await sb.from('categorias').delete().eq('id', id);
    if (error) { toast('Erro: ' + error.message); return; }
    $('#d-cat').close();
    toast('Categoria apagada');
    await loadAll();
  });

  $('#p-apagar').addEventListener('click', async () => {
    const id = $('#p-id').value;
    if (!id || !confirm('Apagar este prazo?')) return;
    const { error } = await sb.from('prazos').delete().eq('id', id);
    if (error) { toast('Erro: ' + error.message); return; }
    $('#d-prazo').close();
    toast('Prazo apagado');
    await loadAll();
  });

  init();
})();
