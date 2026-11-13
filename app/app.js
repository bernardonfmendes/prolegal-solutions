/* Prolegal Solutions: agenda, prazos e faturação. */
(() => {
  'use strict';

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
    $('#fact-mes').value = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}`;
  }

  function render() {
    $('#auth').hidden = !!user || !configOk();
    $('#app').hidden = !user;
    if (user) renderAll();
  }

  // ---------- dados ----------
  async function loadAll() {
    const [r, p, c] = await Promise.all([
      sb.from('reunioes').select('*').order('inicio', { ascending: true }),
      sb.from('prazos').select('*').order('data_limite', { ascending: true }),
      sb.from('categorias').select('*').order('ordem', { ascending: true })
    ]);
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
    const pendente = m.estado === 'agendada' && futura && !m.confirmada;
    const enviada = m.confirmacao_enviada_em
      ? `<span class="muted">Confirmação enviada em ${fmtDataHora(m.confirmacao_enviada_em)}</span>` : '';
    const cat = catDe(m, 'reuniao');
    return `
      <article class="card cat-borda" style="--cat:${esc(cat.cor)}">
        <div class="row">
          <strong>${esc(m.cliente)}</strong>
          <div class="card-chips">${avisoReuniaoAtivo(m) ? '<span class="chip urgente">Aviso</span>' : ''}${m.confirmada ? '<span class="chip ok">Confirmada</span>' : ''}<span class="chip ${esc(m.estado)}">${LABEL[m.estado] || esc(m.estado)}</span></div>
        </div>
        <div class="muted">${fmtDataHora(m.inicio)}${m.fim && !m.dia_todo ? ' – ' + new Date(m.fim).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) : ''}${ehPessoal(m.categoria_id) ? '' : ' · ' + fmtEur(m.honorarios)}</div>
        <div class="cat-nome" style="--cat:${esc(cat.cor)}">${esc(cat.nome)}${m.local ? ' · ' + esc(m.local) : ''}</div>
        ${m.topicos ? `<p>${esc(m.topicos)}</p>` : ''}
        ${enviada ? `<div style="margin-top:6px">${enviada}</div>` : ''}
        <div class="actions">
          ${pendente ? botoesConfirmar(m) : ''}
          ${pendente ? `<button class="btn small" data-confirmada="${m.id}">Confirmou</button>` : ''}
          ${m.estado === 'agendada' && !futura ? `<button class="btn small" data-realizar="${m.id}">Marcar realizada</button>` : ''}
          <button class="btn small" data-edit="${m.id}">Editar</button>
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
          <input type="checkbox" class="prazo-check" data-toggle-prazo="${p.id}" ${p.concluido ? 'checked' : ''} aria-label="Concluído">
          <div class="prazo-info">
            <strong class="prazo-titulo">${esc(p.descricao)}</strong>
            <div class="muted">${esc(p.cliente || 'Sem cliente')}</div>
          </div>
          <span class="chip ${cls}">${estado}</span>
        </div>
        <div class="prazo-foot">
          <span class="data-pill">${fmtDataSimples(p.data_limite)}</span>
          ${avisoPrazoHoje(p) ? '<span class="chip urgente">Aviso hoje</span>' : ''}
          <button class="btn small" data-edit-prazo="${p.id}">Editar</button>
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

    const proximas = reunioes
      .filter((m) => m.estado === 'agendada' && new Date(m.inicio).getTime() >= startOfDay(new Date()).getTime())
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
    reunioes.forEach((m) => {
      if (dayKey(new Date(m.inicio)) === key) out.push({ tipo: 'reuniao', dados: m, hora: m.dia_todo ? null : new Date(m.inicio) });
    });
    prazos.forEach((p) => {
      if (p.data_limite === key) out.push({ tipo: 'prazo', dados: p, hora: null });
    });
    return out.sort((a, b) => (a.hora ? a.hora.getHours() * 60 + a.hora.getMinutes() : -1) - (b.hora ? b.hora.getHours() * 60 + b.hora.getMinutes() : -1));
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
        const c = catDe(it.dados, it.tipo);
        const prazo = it.tipo === 'prazo';
        const texto = prazo ? it.dados.descricao : it.dados.cliente;
        const feito = prazo && it.dados.concluido ? ' feito' : '';
        return `<span class="chip-ev${prazo ? ' lembrete' : ''}${feito}" style="--c-bg:${rgba(c.cor, 0.16)};--c-fg:${esc(c.cor)}">${esc(texto || 'Sem título')}</span>`;
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
      ? itens.map((it) => (it.tipo === 'prazo' ? prazoHtml(it.dados) : cardReuniao(it.dados))).join('')
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

  function corEscolhida() {
    const b = $('#c-cores button[aria-pressed="true"]');
    return b ? b.dataset.cor : CORES[0];
  }

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
    const { error } = await sb.from('prazos').update({ concluido }).eq('id', id);
    if (error) toast('Erro: ' + error.message);
    await loadAll();
  }

  function openReuniao(id, dia) {
    const f = $('#f-reuniao');
    f.reset();
    if (id) {
      const m = reunioes.find((x) => x.id === id);
      if (!m) return;
      $('#r-id').value = m.id;
      $('#r-cliente').value = m.cliente || '';
      $('#r-telefone').value = m.telefone || '';
      $('#r-email').value = m.email || '';
      $('#r-inicio').value = toLocalInput(m.inicio);
      $('#r-fim').value = m.fim ? toLocalInput(m.fim) : '';
      $('#r-diatodo').checked = !!m.dia_todo;
      $('#r-local').value = m.local || '';
      $('#r-repetir').value = m.repetir || 'nunca';
      encherCats('#r-cat', m.categoria_id, 'Reunião');
      aplicarModoPessoal();
      $('#r-honorarios').value = m.honorarios ?? 0;
      $('#r-topicos').value = m.topicos || '';
      $('#r-estado').value = m.estado;
      $('#r-confirmada').checked = !!m.confirmada;
      setAvisosR(m.avisos_min || []);
      $('#d-reuniao-titulo').textContent = 'Editar reunião';
      $('#r-apagar').hidden = false;
    } else {
      $('#r-id').value = '';
      $('#d-reuniao-titulo').textContent = 'Nova reunião';
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
      encherCats('#r-cat', null, 'Reunião');
      aplicarModoPessoal();
      setAvisosR([1440, 120]);
    }
    $('#d-reuniao').showModal();
  }

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
  function setAvisosR(lista) {
    document.querySelectorAll('input[name=avisoR]').forEach((i) => { i.checked = lista.includes(Number(i.value)); });
  }

  // Uma reunião tem aviso ativo quando já chegou a hora de algum dos avisos escolhidos e ainda não passou
  function avisoReuniaoAtivo(m) {
    if (m.estado !== 'agendada' || m.confirmada) return false;
    const t = new Date(m.inicio).getTime();
    const agora = Date.now();
    return t > agora && (m.avisos_min || []).some((min) => agora >= t - min * 60000);
  }

  // ---------- alertas (número no ícone) ----------
  function isInstalada() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function renderAlertas() {
    const pode = 'Notification' in window && isInstalada() && Notification.permission === 'default';
    $('#alertas-bloco').hidden = !pode;
  }

  function atualizarBadge() {
    const agora = Date.now();
    const confirmar = reunioes.filter((m) => {
      const t = new Date(m.inicio).getTime();
      return m.estado === 'agendada' && !m.confirmada && t > agora && t - agora <= 48 * HORA_MS;
    }).length;
    const prazosAbertos = prazos.filter(avisoPrazoHoje).length;
    const total = reunioes.filter(avisoReuniaoAtivo).length + prazosAbertos;
    if (!('setAppBadge' in navigator)) return;
    if (total > 0) navigator.setAppBadge(total).catch(() => {});
    else navigator.clearAppBadge().catch(() => {});
  }

  // ---------- eventos ----------
  let tapTimer = null;
  let tapDia = null;
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('button, [data-day]');
    if (!el) return;

    if (el.id === 'btn-alertas') {
      Notification.requestPermission().then(() => { renderAlertas(); atualizarBadge(); });
      return;
    }
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
        return openReuniao(null, diaSel);
      }
      clearTimeout(tapTimer);
      tapDia = key;
      tapTimer = setTimeout(() => { tapTimer = null; tapDia = null; abrirDPop(key); }, 260);
      return;
    }
    if ('fecharDpop' in el.dataset) return fecharDPop();
    if ('dpopReuniao' in el.dataset) { fecharDPop(); return openReuniao(null, diaSel); }
    if ('dpopPrazo' in el.dataset) { fecharDPop(); return openPrazo(null, diaSel); }
    if ('novaCat' in el.dataset) return openCat(null);
    if (el.dataset.editCat) return openCat(el.dataset.editCat);
    if ('novaReuniao' in el.dataset) return openReuniao(null, null);
    if ('novoDia' in el.dataset) return openReuniao(null, diaSel);
    if (el.dataset.edit) return openReuniao(el.dataset.edit);
    if (el.dataset.confirm) return enviarConfirmacao(el.dataset.confirm, el.dataset.canal);
    if (el.dataset.confirmada) return atualizarReuniao(el.dataset.confirmada, { confirmada: true }, 'Marcada como confirmada');
    if (el.dataset.realizar) return atualizarReuniao(el.dataset.realizar, { estado: 'realizada' }, 'Reunião marcada como realizada');
    if ('novoPrazo' in el.dataset) return openPrazo(null);
    if (el.dataset.editPrazo) return openPrazo(el.dataset.editPrazo);
    if ('close' in el.dataset) return el.closest('dialog').close();
    if ('logout' in el.dataset) { await sb.auth.signOut(); return; }
  });

  document.getElementById('c-cores').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cor]');
    if (!b) return;
    $$('#c-cores button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });

  document.getElementById('dpop').addEventListener('click', (e) => {
    if (e.target.classList.contains('fundo')) fecharDPop();
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'r-cat') aplicarModoPessoal(true);
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
    const inicio = $('#r-inicio').value;
    if (!inicio) { toast('Indique a data e a hora.'); return; }
    const payload = {
      cliente: $('#r-cliente').value.trim(),
      telefone: $('#r-telefone').value.trim() || null,
      email: $('#r-email').value.trim() || null,
      inicio: new Date(inicio).toISOString(),
      honorarios: Number($('#r-honorarios').value) || 0,
      topicos: $('#r-topicos').value.trim() || null,
      estado: $('#r-estado').value,
      confirmada: $('#r-confirmada').checked,
      avisos_min: Array.from(document.querySelectorAll('input[name=avisoR]:checked')).map((i) => Number(i.value))
    };
    if (esquemaNovo) {
      payload.fim = $('#r-fim').value ? new Date($('#r-fim').value).toISOString() : null;
      payload.dia_todo = $('#r-diatodo').checked;
      payload.local = $('#r-local').value.trim() || null;
      payload.repetir = $('#r-repetir').value;
      payload.categoria_id = $('#r-cat').value || null;
    }
    if (id) {
      const orig = reunioes.find((x) => x.id === id);
      // Se a data mudou (remarcação), a confirmação anterior deixa de valer
      if (orig && toLocalInput(orig.inicio) !== inicio) {
        payload.confirmada = false;
        payload.confirmacao_enviada_em = null;
      }
    }
    const res = id
      ? await sb.from('reunioes').update(payload).eq('id', id)
      : await sb.from('reunioes').insert({ ...payload, user_id: user.id });
    if (res.error) { toast('Erro: ' + res.error.message); return; }
    $('#d-reuniao').close();
    toast('Reunião guardada');
    await loadAll();
  });

  $('#r-apagar').addEventListener('click', async () => {
    const id = $('#r-id').value;
    if (!id || !confirm('Apagar esta reunião?')) return;
    const { error } = await sb.from('reunioes').delete().eq('id', id);
    if (error) { toast('Erro: ' + error.message); return; }
    $('#d-reuniao').close();
    toast('Reunião apagada');
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
