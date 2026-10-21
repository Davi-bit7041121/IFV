// Proxy para o Yahoo Finance (quoteSummary) — retorna os indicadores usados no IFV.
// GET /api/proxy?ticker=PETR4  (o sufixo .SA é opcional)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BASE_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
};

const TIMEOUT_MS = 8000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const TICKER_RE = /^[A-Z0-9]{4,7}$/; // PETR4, VALE3, BPAC11, B3SA3...

// Cache em memória (vale enquanto a função serverless estiver "quente"):
// evita 2 requisições extras ao Yahoo (cookie + crumb) a cada busca.
let session = null; // { cookie, crumb, expires }

async function fetchTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getSession(force = false) {
  if (!force && session && session.expires > Date.now()) return session;

  const cookieRes = await fetchTimeout('https://fc.yahoo.com', { headers: BASE_HEADERS });
  const setCookies = typeof cookieRes.headers.getSetCookie === 'function'
    ? cookieRes.headers.getSetCookie()
    : [cookieRes.headers.get('set-cookie') || ''];
  // Mantém só "nome=valor" de cada cookie (descarta Expires, Path, etc.)
  const cookie = setCookies.map(c => c.split(';')[0]).filter(Boolean).join('; ');

  const crumbRes = await fetchTimeout('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { ...BASE_HEADERS, Cookie: cookie },
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || /unauthorized|too many requests/i.test(crumb)) {
    throw new Error('Não foi possível obter crumb do Yahoo Finance');
  }

  session = { cookie, crumb, expires: Date.now() + SESSION_TTL_MS };
  return session;
}

async function fetchSummary(symbol, sess) {
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=defaultKeyStatistics%2CfinancialData%2CsummaryDetail%2Cprice%2CassetProfile` +
    `&crumb=${encodeURIComponent(sess.crumb)}`;
  return fetchTimeout(url, { headers: { ...BASE_HEADERS, Cookie: sess.cookie } });
}

const raw = obj => (obj && typeof obj.raw === 'number' && Number.isFinite(obj.raw)) ? obj.raw : null;
const round = (n, d = 2) => (n === null ? null : +n.toFixed(d));

function fail(res, status, message) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error: message });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return fail(res, 405, 'Método não permitido');
  }

  const param  = Array.isArray(req.query.ticker) ? req.query.ticker[0] : req.query.ticker;
  const base   = String(param || '').trim().toUpperCase().replace(/\.SA$/, '');
  if (!base) return fail(res, 400, 'Ticker obrigatório');
  if (!TICKER_RE.test(base)) return fail(res, 400, 'Ticker inválido');
  const symbol = base + '.SA';

  try {
    let sess    = await getSession();
    let dataRes = await fetchSummary(symbol, sess);

    // Sessão expirada/recusada: renova cookie+crumb e tenta uma vez mais
    if (dataRes.status === 401 || dataRes.status === 403) {
      sess    = await getSession(true);
      dataRes = await fetchSummary(symbol, sess);
    }

    if (dataRes.status === 404) return fail(res, 404, 'Ticker não encontrado: ' + symbol);
    if (!dataRes.ok)            return fail(res, 502, 'Yahoo Finance: HTTP ' + dataRes.status);

    const data   = await dataRes.json();
    const result = data?.quoteSummary?.result?.[0];
    const ks = result?.defaultKeyStatistics;
    const fd = result?.financialData;
    const sd = result?.summaryDetail;
    const pr = result?.price;
    const ap = result?.assetProfile;

    if (!ks || !fd || !sd) return fail(res, 404, 'Ticker não encontrado: ' + symbol);

    // Dívida Líquida / EBITDA
    const totalDebt = raw(fd.totalDebt);
    const totalCash = raw(fd.totalCash);
    const ebitda    = raw(fd.ebitda);
    const netDebt   = (totalDebt !== null && totalCash !== null) ? totalDebt - totalCash : totalDebt;
    // Bancos, seguradoras etc.: Dívida Líquida/EBITDA não se aplica (a dívida é parte da operação)
    const setor      = ap?.sector ?? null;
    const financeira = setor === 'Financial Services';
    const divida     = (!financeira && netDebt !== null && ebitda) ? round(netDebt / ebitda) : null;

    // DY = dividendos dos últimos 12 meses / preço atual (fallback: dividendYield do Yahoo)
    const dividendRate = raw(sd.trailingAnnualDividendRate);
    const precoAtual   = raw(pr?.regularMarketPrice) ?? raw(sd.regularMarketPrice);
    let dy = null;
    if (dividendRate !== null && precoAtual) dy = round((dividendRate / precoAtual) * 100);
    else if (raw(sd.dividendYield) !== null)  dy = round(raw(sd.dividendYield) * 100);

    // P/L: prefere o trailing (12 meses reais) ao forward (projeção)
    const pl  = round(raw(sd.trailingPE) ?? raw(pr?.trailingPE));
    // ROE: Yahoo retorna em decimal (0.15 = 15%)
    const roe = raw(fd.returnOnEquity) !== null ? round(raw(fd.returnOnEquity) * 100) : null;
    // P/VP
    const pvp = round(raw(ks.priceToBook) ?? raw(pr?.priceToBook));

    const nome = pr?.longName ?? pr?.shortName ?? sd?.longName ?? null;

    // Mesma origem (frontend e API no mesmo domínio): CORS aberto não é necessário.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ nome, roe, pl, pvp, dy, divida, financeira, setor });

  } catch (err) {
    if (err.name === 'AbortError') return fail(res, 504, 'Yahoo Finance demorou demais para responder');
    return fail(res, 500, 'Erro interno: ' + err.message);
  }
}
