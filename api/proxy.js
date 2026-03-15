export default async function handler(req, res) {
  const { ticker } = req.query;

  if (!ticker) {
    return res.status(400).json({ error: 'Ticker obrigatório' });
  }

  const symbol = ticker.toUpperCase().endsWith('.SA') ? ticker.toUpperCase() : ticker.toUpperCase() + '.SA';
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData,summaryDetail`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Erro ao buscar dados: ' + response.status });
    }

    const data = await response.json();

    const ks  = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
    const fd  = data?.quoteSummary?.result?.[0]?.financialData;
    const sd  = data?.quoteSummary?.result?.[0]?.summaryDetail;

    if (!ks || !fd || !sd) {
      return res.status(404).json({ error: 'Ticker não encontrado' });
    }

    const debt   = fd?.totalDebt?.raw;
    const ebitda = fd?.ebitda?.raw;
    const divida = (debt != null && ebitda != null && ebitda !== 0)
      ? +(debt / ebitda).toFixed(2)
      : null;

    const resultado = {
      roe:    fd?.returnOnEquity?.raw  != null ? +(fd.returnOnEquity.raw * 100).toFixed(2) : null,
      pl:     sd?.trailingPE?.raw      != null ? +(sd.trailingPE.raw).toFixed(2)           : null,
      pvp:    ks?.priceToBook?.raw     != null ? +(ks.priceToBook.raw).toFixed(2)          : null,
      peg:    ks?.pegRatio?.raw        != null ? +(ks.pegRatio.raw).toFixed(2)             : null,
      dy:     sd?.dividendYield?.raw   != null ? +(sd.dividendYield.raw * 100).toFixed(2)  : null,
      divida,
    };

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300'); // cache de 5 min
    return res.status(200).json(resultado);

  } catch (err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}
