export default async function handler(req, res) {
  const { ticker } = req.query;

  if (!ticker) {
    return res.status(400).json({ error: 'Ticker obrigatório' });
  }

  const symbol = ticker.toUpperCase().endsWith('.SA')
    ? ticker.toUpperCase()
    : ticker.toUpperCase() + '.SA';

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com/',
  };

  try {
    // Passo 1: buscar cookie + crumb (obrigatório desde 2024)
    const cookieRes = await fetch('https://fc.yahoo.com', { headers });
    const cookies   = cookieRes.headers.get('set-cookie') || '';

    const crumbRes  = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...headers, 'Cookie': cookies }
    });
    const crumb = await crumbRes.text();

    if (!crumb || crumb.includes('Unauthorized')) {
      throw new Error('Não foi possível obter crumb do Yahoo Finance');
    }

    // Passo 2: buscar dados com crumb
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics%2CfinancialData%2CsummaryDetail%2Cprice&crumb=${encodeURIComponent(crumb)}`;

    const dataRes = await fetch(url, {
      headers: { ...headers, 'Cookie': cookies }
    });

    if (!dataRes.ok) {
      return res.status(dataRes.status).json({ error: 'Yahoo Finance: HTTP ' + dataRes.status });
    }

    const data = await dataRes.json();

    const ks = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
    const fd = data?.quoteSummary?.result?.[0]?.financialData;
    const sd = data?.quoteSummary?.result?.[0]?.summaryDetail;
    const pr = data?.quoteSummary?.result?.[0]?.price;

    if (!ks || !fd || !sd) {
      return res.status(404).json({ error: 'Ticker não encontrado: ' + symbol });
    }

    // Brapi: DY, ROE e P/VP mais precisos para ações BR (dados direto da B3)
    let dyBrapi = null, roeBrapi = null, pvpBrapi = null, plBrapi = null;
    try {
      const tickerSemSA = symbol.replace('.SA', '');
      const brapiRes = await fetch(`https://brapi.dev/api/quote/${tickerSemSA}?fundamental=true`);
      if (brapiRes.ok) {
        const brapiData = await brapiRes.json();
        const q = brapiData?.results?.[0];
        if (q?.dividendYield  != null) dyBrapi  = +(q.dividendYield).toFixed(2);  // já em %
        if (q?.priceEarnings  != null) plBrapi  = +(q.priceEarnings).toFixed(2);
        if (q?.priceToBook    != null) pvpBrapi = +(q.priceToBook).toFixed(2);
        if (q?.returnOnEquity != null) roeBrapi = +(q.returnOnEquity * 100).toFixed(2);
      }
    } catch (e) { /* se Brapi falhar, usa Yahoo como fallback */ }

    // Debug Brapi
    const _debugBrapi = { dyBrapi, roeBrapi, pvpBrapi, plBrapi };

    // Dívida Líquida ÷ EBITDA (igual ao Status Invest)
    const totalDebt  = fd?.totalDebt?.raw;
    const totalCash  = fd?.totalCash?.raw;
    const ebitda     = fd?.ebitda?.raw;

    const netDebt    = (totalDebt != null && totalCash != null)
      ? totalDebt - totalCash
      : totalDebt ?? null;

    const divida = (netDebt != null && ebitda != null && ebitda !== 0)
      ? +(netDebt / ebitda).toFixed(2)
      : null;

    // DY: Brapi tem prioridade (mais preciso para BR), Yahoo como fallback
    const dividendRate = sd?.trailingAnnualDividendRate?.raw;
    const precoAtual   = pr?.regularMarketPrice?.raw ?? sd?.regularMarketPrice?.raw;
    let dyYahoo = null;
    if (dividendRate != null && precoAtual != null && precoAtual !== 0) {
      dyYahoo = +(( dividendRate / precoAtual) * 100).toFixed(2);
    } else if (sd?.dividendYield?.raw != null) {
      dyYahoo = +(sd.dividendYield.raw * 100).toFixed(2);
    }
    const dy = dyBrapi ?? dyYahoo;

    // Brapi tem prioridade em todos os campos, Yahoo como fallback
    const resultado = {
      roe:    roeBrapi ?? (fd?.returnOnEquity?.raw != null ? +(fd.returnOnEquity.raw * 100).toFixed(2) : null),
      pl:     plBrapi  ?? (sd?.trailingPE?.raw     != null ? +(sd.trailingPE.raw).toFixed(2)           : null),
      pvp:    pvpBrapi ?? (ks?.priceToBook?.raw     != null ? +(ks.priceToBook.raw).toFixed(2)          : null),
      dy,
      divida,
    };

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({ ...resultado, _debugBrapi });

  } catch (err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}
