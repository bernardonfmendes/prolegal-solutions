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
    const [r, p] = await Promise.all([
      sb.from('reunioes').select('*').order('inicio', { ascending: true }),
      sb.from('prazos').select('*').order('data_limite', { ascending: true })
    ]);
    if (r.error || p.error) {
      toast('Não foi possível carregar os dados. Verifique a ligação.');
      return;
    }
    reunioes = r.data || [];
    prazos = p.data || [];
    renderAll();
  }

  function renderAll() {
    renderHoje();
    renderCal();
    renderPrazos();
    renderFact();
  }

  // ---------- cartões ----------
  function cardReuniao(m) {
    const futura = new Date(m.inicio).getTime() > Date.now();
    const pendente = m.estado === 'agendada' && futura && !m.confirmada;
    const enviada = m.confirmacao_enviada_em
      ? `<span class="muted">Confirmação enviada em ${fmtDataHora(m.confirmacao_enviada_em)}</span>` : '';
    return `
      <article class="card">
        <div class="row">
          <strong>${esc(m.cliente)}</strong>
          <span class="chip ${esc(m.estado)}">${LABEL[m.estado] || esc(m.estado)}</span>
        </div>
        <div class="muted">${fmtDataHora(m.inicio)} · ${fmtEur(m.honorarios)}${m.confirmada ? ' · ✔ confirmada' : ''}</div>
        ${m.topicos ? `<p>${esc(m.topicos)}</p>` : ''}
        ${enviada ? `<div style="margin-top:6px">${enviada}</div>` : ''}
        <div class="actions">
          ${pendente && m.contacto ? `<button class="btn small gold" data-confirm="${m.id}">Enviar confirmação</button>` : ''}
          ${pendente ? `<button class="btn small" data-confirmada="${m.id}">Confirmou</button>` : ''}
          ${m.estado === 'agendada' && !futura ? `<button class="btn small" data-realizar="${m.id}">Marcar realizada</button>` : ''}
          <button class="btn small" data-edit="${m.id}">Editar</button>
        </div>
      </article>`;
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
        <label class="row" style="justify-content:flex-start;cursor:pointer;color:var(--ink);margin:0">
          <input type="checkbox" data-toggle-prazo="${p.id}" ${p.concluido ? 'checked' : ''} style="width:auto">
          <strong>${esc(p.descricao)}</strong>
        </label>
        <div class="muted">${esc(p.cliente || 'Sem cliente')} · ${fmtDataSimples(p.data_limite)} · ${estado}</div>
        <div class="actions"><button class="btn small" data-edit-prazo="${p.id}">Editar</button></div>
      </article>`;
  }

  // ---------- hoje ----------
  function renderHoje() {
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
            ${m.contacto ? `<button class="btn small gold" data-confirm="${m.id}">Enviar confirmação</button>` : '<span class="muted">Sem contacto guardado</span>'}
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
      const count = reunioes.filter((m) => dayKey(new Date(m.inicio)) === key).length;
      const cls = ['cal-day'];
      if (d.getMonth() !== mesCal.getMonth()) cls.push('out');
      if (key === hoje) cls.push('today');
      if (key === sel) cls.push('sel');
      cells += `<button class="${cls.join(' ')}" data-day="${key}" aria-label="${key}">
        <span>${d.getDate()}</span>${count ? `<i>${count}</i>` : ''}</button>`;
    }
    $('#cal-grid').innerHTML = cells;
    $('#cal-titulo').textContent = mesCal.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });

    const lista = reunioes.filter((m) => dayKey(new Date(m.inicio)) === sel);
    $('#cal-dia').innerHTML = `
      <h3 style="margin:14px 0 10px;text-transform:capitalize">${diaSel.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
      ${lista.length ? lista.map(cardReuniao).join('') : '<p class="empty">Sem reuniões neste dia.</p>'}
      <button class="btn primary" data-novo-dia>+ Nova reunião neste dia</button>`;
  }

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
      return d.getFullYear() === y && d.getMonth() === mNum - 1;
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

  async function enviarConfirmacao(id) {
    const m = reunioes.find((x) => x.id === id);
    if (!m) return;
    const contacto = (m.contacto || '').trim();
    if (!contacto) { toast('Esta reunião não tem contacto guardado.'); return; }
    const texto = textoConfirmacao(m);

    let url;
    if (contacto.includes('@')) {
      url = `mailto:${encodeURIComponent(contacto)}?subject=${encodeURIComponent('Confirmação de reunião')}&body=${encodeURIComponent(texto)}`;
    } else {
      let digits = contacto.replace(/\D/g, '');
      if (digits.length === 9) digits = '351' + digits; // número português sem indicativo
      url = `https://wa.me/${digits}?text=${encodeURIComponent(texto)}`;
    }

    // Regista que a mensagem foi preparada. A confirmação real do cliente é marcada à parte.
    const agora = new Date().toISOString();
    const { error } = await sb.from('reunioes').update({ confirmacao_enviada_em: agora }).eq('id', id);
    if (error) toast('Não foi possível registar o envio.');

    if (url.startsWith('mailto:')) window.location.href = url;
    else window.open(url, '_blank', 'noopener');
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
      $('#r-contacto').value = m.contacto || '';
      $('#r-inicio').value = toLocalInput(m.inicio);
      $('#r-honorarios').value = m.honorarios ?? 0;
      $('#r-topicos').value = m.topicos || '';
      $('#r-estado').value = m.estado;
      $('#r-confirmada').checked = !!m.confirmada;
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
    }
    $('#d-reuniao').showModal();
  }

  function openPrazo(id) {
    $('#f-prazo').reset();
    if (id) {
      const p = prazos.find((x) => x.id === id);
      if (!p) return;
      $('#p-id').value = p.id;
      $('#p-descricao').value = p.descricao;
      $('#p-cliente').value = p.cliente || '';
      $('#p-data').value = p.data_limite;
      $('#d-prazo-titulo').textContent = 'Editar prazo';
      $('#p-apagar').hidden = false;
    } else {
      $('#p-id').value = '';
      $('#d-prazo-titulo').textContent = 'Novo prazo';
      $('#p-apagar').hidden = true;
    }
    $('#d-prazo').showModal();
  }

  function showTab(id) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === id));
    $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- eventos ----------
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('button, [data-day]');
    if (!el) return;

    if (el.dataset.tab) return showTab(el.dataset.tab);
    if (el.dataset.mes) {
      mesCal = new Date(mesCal.getFullYear(), mesCal.getMonth() + Number(el.dataset.mes), 1);
      return renderCal();
    }
    if (el.dataset.day) {
      const [y, mo, d] = el.dataset.day.split('-').map(Number);
      diaSel = new Date(y, mo - 1, d);
      return renderCal();
    }
    if ('novaReuniao' in el.dataset) return openReuniao(null, null);
    if ('novoDia' in el.dataset) return openReuniao(null, diaSel);
    if (el.dataset.edit) return openReuniao(el.dataset.edit);
    if (el.dataset.confirm) return enviarConfirmacao(el.dataset.confirm);
    if (el.dataset.confirmada) return atualizarReuniao(el.dataset.confirmada, { confirmada: true }, 'Marcada como confirmada');
    if (el.dataset.realizar) return atualizarReuniao(el.dataset.realizar, { estado: 'realizada' }, 'Reunião marcada como realizada');
    if ('novoPrazo' in el.dataset) return openPrazo(null);
    if (el.dataset.editPrazo) return openPrazo(el.dataset.editPrazo);
    if ('close' in el.dataset) return el.closest('dialog').close();
    if ('logout' in el.dataset) { await sb.auth.signOut(); return; }
  });

  document.addEventListener('change', (e) => {
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
      contacto: $('#r-contacto').value.trim() || null,
      inicio: new Date(inicio).toISOString(),
      honorarios: Number($('#r-honorarios').value) || 0,
      topicos: $('#r-topicos').value.trim() || null,
      estado: $('#r-estado').value,
      confirmada: $('#r-confirmada').checked
    };
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
      data_limite: $('#p-data').value
    };
    const res = id
      ? await sb.from('prazos').update(payload).eq('id', id)
      : await sb.from('prazos').insert({ ...payload, user_id: user.id });
    if (res.error) { toast('Erro: ' + res.error.message); return; }
    $('#d-prazo').close();
    toast('Prazo guardado');
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
