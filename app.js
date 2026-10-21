// ── State ──
let ranking = [];
let filtroAtual = "todas";
let sortCol = "ifv";
let sortDir = "desc";

// ── Persist ──
function loadRanking() {
  try {
    const raw = localStorage.getItem("rankingIFV");
    if (raw) {
      const arr = JSON.parse(raw);
      ranking = (Array.isArray(arr) ? arr : [])
        .filter(r => r && typeof r.ticker === 'string' && hasValidIndicators(r))
        .map(r => buildEntry(
          r.ticker, typeof r.nome === 'string' ? r.nome : '',
          normalizeVals(r),
          r.updatedAt || new Date().toISOString(), r.createdAt || r.updatedAt || new Date().toISOString()
        ));
    }
  } catch(e) { ranking = []; toast("⚠ Erro ao carregar dados salvos"); }
}
function saveRanking() {
  ranking.sort((a, b) => b.ifv - a.ifv);
  try { localStorage.setItem("rankingIFV", JSON.stringify(ranking)); }
  catch(e) { toast("⚠ Não foi possível salvar — armazenamento indisponível"); }
}

// ── Score fns ──
const scoreROE    = v => v<5?1:v<10?2:v<15?3:v<25?4:5;
const scorePL     = v => v<=0?1:v>30?1:v>20?2:v>12?3:v>6?4:5;
const scorePVP    = v => v<=0?1:v>3?1:v>2?2:v>1?3:v>0.7?4:5;
const scoreDY     = v => v<2?1:v<4?2:v<6?3:v<10?4:5;
const scoreDivida = v => v>4?1:v>3?2:v>2?3:v>1?4:5;

const scoreMap = { roe:scoreROE, pl:scorePL, pvp:scorePVP, dy:scoreDY, divida:scoreDivida };
const fields   = ['roe','pl','pvp','dy','divida'];
// DL/EBITDA é opcional: não se aplica a bancos, seguradoras etc. Nesse caso (null) fica fora da média.
const requiredFields = ['roe','pl','pvp','dy'];
const radarShort = { roe:'ROE', pl:'P/L', pvp:'P/VP', dy:'DY', divida:'Dívida' };
const statLabel  = { roe:'ROE', pl:'P/L', pvp:'P/VP', dy:'DY', divida:'DL/EBITDA' };

// Indicadores válidos: obrigatórios numéricos; divida numérica ou ausente (null)
function hasValidIndicators(r) {
  return !!r && requiredFields.every(f => Number.isFinite(r[f])) &&
         (r.divida === null || r.divida === undefined || Number.isFinite(r.divida));
}
// Normaliza: ausente/ inválido → null
const normalizeVals = r => Object.fromEntries(fields.map(f => [f, Number.isFinite(r[f]) ? r[f] : null]));

// Dados do radar: só os indicadores aplicáveis
function radarData(r) {
  const labels = [], scores = [];
  for (const f of fields) {
    if (!Number.isFinite(r[f])) continue;
    labels.push(radarShort[f]);
    scores.push(scoreMap[f](r[f]));
  }
  return { labels, scores };
}

const scoreColor = s => s<=1?'#f85149':s<=2?'#f0883e':s<=3?'#d29922':s<=4?'#3fb950':'#00e5ff';

const classifyIFV = ifv =>
  ifv>=9.0?"extraordinária":ifv>=7.0?"muito boa":ifv>=5.0?"razoável":ifv>=3.0?"cara":"muito cara";

function classBadgeClass(c) {
  return 'badge-' + c.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s/g,'').toLowerCase();
}
function classColor(c) {
  if(c==="extraordinária") return '#00e5ff';
  if(c==="muito boa")      return '#3fb950';
  if(c==="razoável")       return '#d29922';
  if(c==="cara")           return '#f0883e';
  return '#f85149';
}

// ── Segurança: escapa texto antes de ir para innerHTML ──
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// ── Monta uma entrada do ranking (fonte única de verdade para IFV/scores) ──
function buildEntry(ticker, nome, vals, updatedAt, createdAt) {
  const scores = {};
  const aplicaveis = fields.filter(f => Number.isFinite(vals[f]));
  for (const f of aplicaveis) scores[f] = scoreMap[f](vals[f]);
  const ifv = (aplicaveis.reduce((acc, f) => acc + scores[f], 0) / aplicaveis.length) * 2;
  return {
    ticker, nome, ifv, classificacao: classifyIFV(ifv),
    ...vals,
    sroe: scores.roe, spl: scores.pl, spvp: scores.pvp, sdy: scores.dy, sdivida: scores.divida ?? null,
    updatedAt, createdAt,
  };
}

// ── Nome da empresa abaixo do campo ticker ──
function setNomeEmpresa(nome) {
  window._nomeEmpresa = nome || '';
  let el = document.getElementById('ticker-nome');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ticker-nome';
    el.className = 'ticker-nome';
    document.querySelector('.ticker-input-wrap').appendChild(el);
  }
  el.textContent = nome || '';
}

// ── Range validation ──
const rangeConfig = {
  roe:    { min: -100, max: 200,  hint: v => v < 0 ? 'ROE negativo — prejuízo' : v > 60 ? 'Valor atipicamente alto' : '' },
  pl:     { min: -500, max: 1000, hint: v => v < 0 ? 'P/L negativo — prejuízo' : v > 100 ? 'P/L muito elevado' : '' },
  pvp:    { min: -50,  max: 50,   hint: v => v < 0 ? 'P/VP negativo — incomum' : v > 10 ? 'P/VP muito elevado' : '' },
  dy:     { min: 0,    max: 100,  hint: v => v > 25 ? 'DY muito elevado — verifique' : '' },
  divida: { min: -10,  max: 50,   hint: v => v < 0 ? 'Dívida negativa (caixa líquido)' : v > 6 ? 'Alavancagem alta' : '' },
};

function validateField(field, val) {
  const cfg  = rangeConfig[field];
  const el   = document.getElementById(field);
  const hint = document.getElementById('hint-' + field);
  el.classList.remove('input-warn','input-error');
  hint.textContent = '';
  if (isNaN(val)) return;
  if (val < cfg.min || val > cfg.max) {
    el.classList.add('input-error');
    hint.textContent = `Fora do range (${cfg.min} a ${cfg.max})`;
    hint.style.color = 'var(--red)';
    return;
  }
  const msg = cfg.hint(val);
  if (msg) {
    el.classList.add('input-warn');
    hint.textContent = msg;
    hint.style.color = 'var(--orange)';
  }
}

function updateScore(field) {
  const val = parseFloat(document.getElementById(field).value);
  const sc  = document.getElementById('sc-' + field);
  const bar = document.getElementById('bar-' + field);
  validateField(field, val);
  if (field === 'divida' && document.getElementById('divida-na')?.checked) {
    sc.textContent = 'N/A'; sc.classList.add('visible');
    bar.style.width = '0%'; bar.style.background = 'var(--border)';
    const hint = document.getElementById('hint-divida');
    hint.textContent = 'Fora do cálculo do IFV'; hint.style.color = 'var(--muted)';
    return;
  }
  if (isNaN(val)) {
    sc.textContent = '—'; sc.classList.remove('visible');
    bar.style.width = '0%'; bar.style.background = 'var(--border)';
    return;
  }
  const s = scoreMap[field](val);
  sc.textContent = s + '/5'; sc.classList.add('visible');
  bar.style.width = (s/5*100) + '%';
  bar.style.background = scoreColor(s);
}

// ── "Não se aplica" para DL/EBITDA (bancos, seguradoras...) ──
function setDividaNA(on) {
  const chk = document.getElementById('divida-na');
  const inp = document.getElementById('divida');
  chk.checked = on;
  inp.disabled = on;
  if (on) inp.value = '';
  updateScore('divida');
}
function toggleDividaNA() { setDividaNA(document.getElementById('divida-na').checked); }

// ── Buscar Yahoo Finance ──
async function buscarYahoo() {
  const ticker = document.getElementById('ticker').value.trim().toUpperCase();
  if (!ticker) { toast('⚠ Informe o ticker antes de buscar'); document.getElementById('ticker').focus(); return; }

  const btn    = document.getElementById('btnFetch');
  const status = document.getElementById('fetchStatus');
  const icon   = document.getElementById('fetchIcon');

  btn.disabled    = true;
  icon.className  = 'spin';
  icon.textContent = '⟳';
  status.style.color = 'var(--muted)';
  status.textContent = 'Buscando dados…';

  const symbol = ticker.endsWith('.SA') ? ticker : ticker + '.SA';
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`/api/proxy?ticker=${encodeURIComponent(symbol)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const map = await res.json();
    if (map.error) throw new Error(map.error);

    if (map.nome) setNomeEmpresa(map.nome);
    const nomes = { roe:'ROE', pl:'P/L', pvp:'P/VP', dy:'DY', divida:'DL/EBITDA' };
    const ausentes = [];
    const financeira = map.financeira === true;
    setDividaNA(financeira); // instituição financeira → DL/EBITDA não se aplica

    // Itera só nos campos do formulário, ignora nome e outros campos extras
    for (const [field, label] of Object.entries(nomes)) {
      if (field === 'divida' && financeira) continue;
      const val = map[field];
      if (val !== null && val !== undefined) {
        document.getElementById(field).value = val;
        validateField(field, val);
        updateScore(field);
      } else {
        ausentes.push(label);
      }
    }

    icon.className  = '';
    icon.textContent = '✓';
    if (ausentes.length === 0) {
      status.style.color = 'var(--green)';
      status.textContent = financeira
        ? '✓ Preenchido — DL/EBITDA não se aplica (instituição financeira)'
        : '✓ Todos os campos preenchidos';
    } else {
      status.style.color = 'var(--orange)';
      status.textContent = `⚠ Preencha manualmente: ${ausentes.join(', ')}` +
        (ausentes.includes('DL/EBITDA') ? ' (DL/EBITDA pode ser “Não se aplica”)' : '');
    }

  } catch (err) {
    icon.className  = '';
    icon.textContent = '⟳';
    status.style.color = 'var(--red)';

    if (err.name === 'AbortError') {
      status.textContent = '✕ Tempo esgotado — tente novamente';
    } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      status.textContent = '✕ Sem conexão ou CORS bloqueado';
    } else if (err.message.includes('404') || err.message.includes('não encontrado') || err.message.includes('Ticker')) {
      status.textContent = '✕ Ticker não encontrado — tente com .SA';
    } else {
      status.textContent = '✕ Erro: ' + err.message;
    }
    toast('⚠ Não foi possível buscar dados do Yahoo Finance');
  } finally {
    clearTimeout(timer);
    btn.disabled = false;
    setTimeout(() => {
      if (status.textContent.startsWith('✓')) {
        status.textContent = '';
        icon.textContent = '⟳';
      }
    }, 4000);
  }
}

function handleTickerPaste(e) {
  e.preventDefault();
  const pasted = (e.clipboardData || window.clipboardData).getData('text');
  document.getElementById('ticker').value = pasted.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

// ── Calcular ──
function calcular() {
  const ticker = document.getElementById("ticker").value.trim().toUpperCase();
  if (!ticker) { document.getElementById('ticker').focus(); shake(); toast("⚠ Informe o ticker do ativo"); return; }

  const naDivida = document.getElementById('divida-na').checked;
  const vals = {};
  for (const f of fields) vals[f] = (f === 'divida' && naDivida) ? null : parseFloat(document.getElementById(f).value);
  const faltando = fields.filter(f => vals[f] !== null && isNaN(vals[f]));
  if (faltando.length) {
    shake();
    toast("⚠ Preencha todos os indicadores" + (faltando.includes('divida') ? " (DL/EBITDA pode ser “Não se aplica”)" : ""));
    return;
  }

  const outOfRange = fields.filter(f => {
    if (vals[f] === null) return false;
    const cfg = rangeConfig[f];
    return vals[f] < cfg.min || vals[f] > cfg.max;
  });
  if (outOfRange.length) { shake(); toast("⚠ Corrija os valores fora do range"); return; }

  const now = new Date().toISOString();
  const entry = buildEntry(ticker, window._nomeEmpresa || '', vals, now, now);

  const idx = ranking.findIndex(r => r.ticker === ticker);
  if (idx >= 0) {
    entry.createdAt = ranking[idx].createdAt || now;
    ranking[idx] = entry;
    toast("✓ " + ticker + " atualizado");
  } else {
    entry.createdAt = now;
    ranking.push(entry);
    toast("✓ " + ticker + " adicionado");
  }

  saveRanking();
  showResult(entry);
  render();
}

// ── Cria canvas com dimensão correta para cada contexto ──
// totalSize: tamanho total do canvas em px
// polygonRadius: raio do polígono (deve ser totalSize/2 - LABEL_MARGIN)
// LABEL_MARGIN garante que nenhum label seja cortado
function makeRadarCanvas(totalSize, polygonRadius) {
  const cvs = document.createElement('canvas');
  cvs.width  = totalSize;
  cvs.height = totalSize;
  return { cvs, polygonRadius };
}

function showResult(r) {
  const res = document.getElementById("resultado");
  res.classList.add('visible');
  document.getElementById("res-ticker").textContent = r.ticker;
  let resCompany = document.getElementById('res-company');
  if (!resCompany) {
    resCompany = document.createElement('div');
    resCompany.id = 'res-company';
    resCompany.className = 'result-company';
    document.getElementById('res-ticker').insertAdjacentElement('afterend', resCompany);
  }
  resCompany.textContent = r.nome || '';
  const ifvEl = document.getElementById("res-ifv");
  ifvEl.textContent = r.ifv.toFixed(2);
  ifvEl.style.color = classColor(r.classificacao);
  const cl = document.getElementById("res-class");
  cl.textContent = r.classificacao.toUpperCase();
  cl.className = 'result-class ' + classBadgeClass(r.classificacao);
  document.getElementById("res-gauge").style.width = (r.ifv/10*100) + '%';

  const { labels, scores } = radarData(r);
  const noteEl = document.getElementById('res-note');
  if (noteEl) noteEl.textContent = labels.length < fields.length
    ? `IFV calculado com ${labels.length} indicadores (DL/EBITDA não se aplica)` : '';

  const wrap = document.getElementById('resultRadarWrap');
  wrap.innerHTML = '';
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = 260;
  wrap.appendChild(cvs);
  drawRadar(cvs, scores, classColor(r.classificacao), 78, labels);
}

// ── Editar ──
function editar(ticker) {
  const r = ranking.find(x => x.ticker === ticker);
  if (!r) return;
  document.getElementById("ticker").value = r.ticker;
  setNomeEmpresa(r.nome || '');
  for (const f of fields) { document.getElementById(f).value = Number.isFinite(r[f]) ? r[f] : ''; }
  setDividaNA(!Number.isFinite(r.divida));
  fields.forEach(f => { validateField(f, Number.isFinite(r[f]) ? r[f] : NaN); updateScore(f); });
  showResult(r);
  if (window.innerWidth <= 700) switchTab('left', document.querySelector('.tab-bar button'));
  else document.getElementById('panelLeft').scrollIntoView({behavior:'smooth'});
}

// ── Delete ──
let pendingDeleteTicker = null;
function excluir(ticker) {
  pendingDeleteTicker = ticker;
  document.getElementById('modalTicker').textContent = ticker;
  document.getElementById('modalOverlay').style.display = 'flex';
}
document.getElementById('btnConfirmDelete').addEventListener('click', () => {
  if (!pendingDeleteTicker) return;
  const t = pendingDeleteTicker;
  ranking = ranking.filter(r => r.ticker !== t);
  saveRanking(); render();
  toast("✕ " + t + " removido");
  pendingDeleteTicker = null;
  document.getElementById('modalOverlay').style.display = 'none';
});
function closeModal(e) {
  if (e && e.target !== document.getElementById('modalOverlay')) return;
  pendingDeleteTicker = null;
  document.getElementById('modalOverlay').style.display = 'none';
}

// ── Radar Modal ──
function abrirRadar(ticker) {
  const r = ranking.find(x => x.ticker === ticker);
  if (!r) return;
  document.getElementById('radarModalTitle').textContent = r.ticker + ' — Radar';
  document.getElementById('radarModalSub').textContent   = 'IFV ' + r.ifv.toFixed(2) + ' · ' + r.classificacao;

  const { labels, scores } = radarData(r);

  const container = document.getElementById('radarContainer');
  container.innerHTML = '';
  // 340px canvas, 104px de raio → 66px de margem para labels em cada lado
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = 340;
  container.appendChild(cvs);
  drawRadar(cvs, scores, classColor(r.classificacao), 104, labels);

  const units = { roe:'%', pl:'×', pvp:'×', dy:'%', divida:'×' };
  document.getElementById('radarStats').innerHTML = fields.map(f => {
    const ok = Number.isFinite(r[f]);
    const s  = ok ? scoreMap[f](r[f]) : null;
    const val = ok
      ? `${r[f]}${units[f]} <span style="font-size:10px;opacity:0.6">(${s}/5)</span>`
      : 'N/A';
    return `<div class="radar-stat">
      <div class="radar-stat-label">${statLabel[f]}</div>
      <div class="radar-stat-val" style="color:${ok ? scoreColor(s) : 'var(--muted)'}">${val}</div>
    </div>`;
  }).join('');

  document.getElementById('radarModal').style.display = 'flex';
}
function closeRadarModal(e) {
  if (e && e.target !== document.getElementById('radarModal')) return;
  document.getElementById('radarModal').style.display = 'none';
}

// ── drawRadar ──
// canvas   : elemento <canvas> já dimensionado (quadrado)
// scores   : array (4 ou 5) com valores 1-5; labels deve ter o mesmo tamanho
// color    : cor hex do ativo
// polyR    : raio do polígono de dados em px
//            A margem para labels = (canvas.width/2 - polyR), deve ser >= 30px
function drawRadar(canvas, scores, color, polyR, labels = ['ROE', 'P/L', 'P/VP', 'DY', 'Dívida']) {
  const ctx = canvas.getContext('2d');
  const S   = canvas.width;          // side (canvas é quadrado)
  const cx  = S / 2;
  const cy  = S / 2;
  const N   = scores.length;
  const LABELS = labels;

  ctx.clearRect(0, 0, S, S);

  const ao    = -Math.PI / 2;
  const angle = i => (i / N) * Math.PI * 2 + ao;

  // Anéis de referência
  for (let ring = 1; ring <= 5; ring++) {
    const r = (ring / 5) * polyR;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = angle(i);
      i === 0
        ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
        : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.closePath();
    ctx.strokeStyle = ring === 5 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)';
    ctx.lineWidth   = 1;
    ctx.stroke();
  }

  // Raios
  for (let i = 0; i < N; i++) {
    const a = angle(i);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + polyR * Math.cos(a), cy + polyR * Math.sin(a));
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 1;
    ctx.stroke();
  }

  // Polígono de dados
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const r = (scores[i] / 5) * polyR;
    const a = angle(i);
    i === 0
      ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
      : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
  const h2r = (hex, alpha) => {
    const rv = parseInt(hex.slice(1,3),16), gv = parseInt(hex.slice(3,5),16), bv = parseInt(hex.slice(5,7),16);
    return `rgba(${rv},${gv},${bv},${alpha})`;
  };
  ctx.fillStyle   = h2r(color, 0.18);
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2;
  ctx.fill();
  ctx.stroke();

  // Pontos nos vértices
  for (let i = 0; i < N; i++) {
    const r = (scores[i] / 5) * polyR;
    const a = angle(i);
    ctx.beginPath();
    ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Labels
  // Margem disponível fora do polígono = cx - polyR
  // Posicionamos o texto a 60% da margem disponível além do polígono
  const margin      = cx - polyR;
  const labelR      = polyR + margin * 0.62;
  const fontSize    = Math.max(9, Math.min(11, Math.floor(margin * 0.36)));

  ctx.font         = `bold ${fontSize}px 'Space Mono', monospace`;
  ctx.fillStyle    = 'rgba(255,255,255,0.62)';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < N; i++) {
    const a  = angle(i);
    const lx = cx + labelR * Math.cos(a);
    const ly = cy + labelR * Math.sin(a);

    // Alinha pelo ângulo: texto à esquerda do ponto quando o eixo aponta à esquerda
    const cosA = Math.cos(a);
    if      (cosA >  0.1) ctx.textAlign = 'left';
    else if (cosA < -0.1) ctx.textAlign = 'right';
    else                  ctx.textAlign = 'center';

    ctx.fillText(LABELS[i], lx, ly);
  }
}

// ── Export (robusto) ──
function exportarJSON() {
  if (!ranking.length) { toast("⚠ Nenhum ativo para exportar"); return; }

  const json = JSON.stringify(ranking, null, 2);
  const nome = 'ifv-ranking-' + new Date().toISOString().slice(0, 10) + '.json';

  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("↓ Exportado com sucesso");
    return;
  } catch(e) {}

  try {
    const uri = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
    const a   = document.createElement('a');
    a.href = uri; a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast("↓ Exportado com sucesso");
    return;
  } catch(e) {}

  const w = window.open('', '_blank');
  if (w) {
    w.document.write('<pre>' + json.replace(/</g, '&lt;') + '</pre>');
    toast("↓ JSON aberto em nova aba — salve com Ctrl+S");
  } else {
    toast("⚠ Permita popups e tente novamente");
  }
}

// ── Import ──
function openImportModal() {
  document.getElementById('importTextarea').value = '';
  document.getElementById('importModal').style.display = 'flex';
}
function closeImportModal(e) {
  if (e && e.target !== document.getElementById('importModal')) return;
  document.getElementById('importModal').style.display = 'none';
}

document.getElementById('importFileInput').addEventListener('change', function() {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => { document.getElementById('importTextarea').value = e.target.result; };
  reader.readAsText(file);
  this.value = '';
});

function confirmarImport() {
  const raw = document.getElementById('importTextarea').value.trim();
  if (!raw) { toast("⚠ Nenhum conteúdo para importar"); return; }
  let data;
  try { data = JSON.parse(raw); }
  catch(e) { toast("⚠ JSON inválido — verifique o arquivo"); return; }
  if (!Array.isArray(data) || !data.length) { toast("⚠ Arquivo vazio ou formato inválido"); return; }

  const valid = data.filter(r =>
    r && typeof r.ticker === 'string' && hasValidIndicators(r) &&
    fields.every(f => r[f] == null || (r[f] >= rangeConfig[f].min && r[f] <= rangeConfig[f].max))
  );
  if (!valid.length) { toast("⚠ Nenhum item válido encontrado"); return; }

  let added = 0, updated = 0, skipped = data.length - valid.length;
  const isoOrNow = s => (typeof s === 'string' && !isNaN(Date.parse(s))) ? s : new Date().toISOString();
  for (const r of valid) {
    const ticker = r.ticker.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    if (!ticker) { skipped++; continue; }
    const vals = normalizeVals(r);
    const entry = buildEntry(ticker, typeof r.nome === 'string' ? r.nome.slice(0, 120) : '',
                             vals, isoOrNow(r.updatedAt), isoOrNow(r.createdAt));
    const idx = ranking.findIndex(x => x.ticker === ticker);
    if (idx >= 0) { ranking[idx] = entry; updated++; }
    else { ranking.push(entry); added++; }
  }

  saveRanking(); render();
  toast(`✓ Importado: ${added} adicionado${added!==1?'s':''}, ${updated} atualizado${updated!==1?'s':''}` + (skipped ? `, ${skipped} ignorado${skipped!==1?'s':''}` : ''));
  document.getElementById('importModal').style.display = 'none';
}

// ── Filter ──
function setFilter(f, btn) {
  filtroAtual = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  render();
}

// ── Sort ──
document.querySelectorAll('th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortCol = col; sortDir = col === 'ifv' ? 'desc' : 'asc'; }
    document.querySelectorAll('th[data-col]').forEach(t => {
      t.classList.remove('sort-asc','sort-desc');
      if (t.dataset.col === col) t.classList.add(sortDir==='asc'?'sort-asc':'sort-desc');
    });
    render();
  });
});

// ── Timestamp ──
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit', year:'2-digit'}) +
    ' ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
}

// ── Render ──
function render() {
  let lista = [...ranking];
  if (filtroAtual !== "todas") lista = lista.filter(r => r.classificacao === filtroAtual);

  lista.sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    if (sortCol === 'updatedAt') { va = va||''; vb = vb||''; }
    if (typeof va === 'string') return sortDir==='asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortDir==='asc' ? va-vb : vb-va;
  });

  const total = ranking.length;
  const extr  = ranking.filter(r => r.classificacao==='extraordinária').length;
  const avg   = total ? ranking.reduce((s,r) => s+r.ifv, 0)/total : 0;
  const best  = total ? Math.max(...ranking.map(r => r.ifv)) : null;

  document.getElementById('st-total').textContent = total;
  document.getElementById('st-best').textContent  = best!==null ? best.toFixed(2) : '—';
  document.getElementById('st-avg').textContent   = total ? avg.toFixed(2) : '—';
  document.getElementById('st-extr').textContent  = extr;
  document.getElementById('count-badge').textContent = lista.length + ' ativo' + (lista.length!==1?'s':'');

  const tbody = document.getElementById("tbody");
  const empty = document.getElementById("empty-state");
  if (!lista.length) { tbody.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display = 'none';

  const byIFV    = [...ranking].sort((a,b) => b.ifv-a.ifv);
  const medalMap = {};
  if (byIFV[0]) medalMap[byIFV[0].ticker] = '🥇';
  if (byIFV[1]) medalMap[byIFV[1].ticker] = '🥈';
  if (byIFV[2]) medalMap[byIFV[2].ticker] = '🥉';

  tbody.innerHTML = lista.map((r, i) => {
    const medalEmoji = medalMap[r.ticker] || '';
    const medal      = medalEmoji ? `<span class="medal">${medalEmoji}</span>` : '';
    const pos        = i + 1;
    const ifvColor   = classColor(r.classificacao);
    const pct        = (r.ifv/10*100).toFixed(0);
    const badge      = classBadgeClass(r.classificacao);
    const sroe = r.sroe ?? scoreROE(r.roe);
    const spl  = r.spl  ?? scorePL(r.pl);
    const spvp = r.spvp ?? scorePVP(r.pvp);
    const sdy  = r.sdy  ?? scoreDY(r.dy);

    return `<tr>
      <td><div class="rank-num">${medal}<span>${medal?'':pos}</span></div></td>
      <td><div class="ticker-cell" data-action="edit" data-ticker="${esc(r.ticker)}" title="Clique para editar">${esc(r.ticker)}${r.nome ? `<div class="company-name">${esc(r.nome)}</div>` : ''}</div></td>
      <td>
        <div class="ifv-cell" style="color:${ifvColor}">${r.ifv.toFixed(2)}</div>
        <div class="ifv-mini-bar"><div class="ifv-mini-fill" style="width:${pct}%;background:${ifvColor}"></div></div>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="class-badge ${badge}">${r.classificacao}</span>
        </div>
      </td>
      <td class="col-indicators">
        <div class="indicator-pills">
          <span class="pill" style="color:${scoreColor(sroe)}">ROE ${r.roe}%</span>
          <span class="pill" style="color:${scoreColor(spl)}">P/L ${r.pl}</span>
          <span class="pill" style="color:${scoreColor(spvp)}">P/VP ${r.pvp}</span>
          <span class="pill" style="color:${scoreColor(sdy)}">DY ${r.dy}%</span>
          ${Number.isFinite(r.divida) ? '' : '<span class="pill">DL/EBITDA N/A</span>'}
        </div>
      </td>
      <td class="col-ts ts-cell">${fmtDate(r.updatedAt)}</td>
      <td style="text-align:right;white-space:nowrap;width:70px">
        <button class="btn-radar" data-action="radar" data-ticker="${esc(r.ticker)}" title="Ver radar" aria-label="Ver radar de ${esc(r.ticker)}">◎</button>
        <button class="btn-delete" data-action="delete" data-ticker="${esc(r.ticker)}" title="Remover" aria-label="Remover ${esc(r.ticker)}">✕</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Keyboard shortcuts ──
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeRadarModal(); closeImportModal(); }
  if (e.key === 'Enter' && document.getElementById('modalOverlay').style.display === 'flex')
    document.getElementById('btnConfirmDelete').click();
});

// ── Mobile tabs ──
function switchTab(panel, btn) {
  document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panelLeft').classList.toggle('tab-active',  panel==='left');
  document.getElementById('panelRight').classList.toggle('tab-active', panel==='right');
}

// ── Helpers ──
function shake() {
  const el = document.getElementById('panelLeft');
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 400);
}
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'notif'; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// ── Eventos da tabela (delegação) ──
document.getElementById('tbody').addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const t = el.dataset.ticker;
  if (el.dataset.action === 'edit')   editar(t);
  if (el.dataset.action === 'radar')  abrirRadar(t);
  if (el.dataset.action === 'delete') excluir(t);
});

// ── Enter: ticker busca dados; indicadores calculam ──
document.getElementById('ticker').addEventListener('keydown', e => { if (e.key === 'Enter') buscarYahoo(); });
fields.forEach(f => document.getElementById(f).addEventListener('keydown', e => { if (e.key === 'Enter') calcular(); }));

// ── Init ──
loadRanking();
render();
