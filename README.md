# IFV Analyzer

Ferramenta web para ranquear ações da B3 pelo **IFV** (Índice de Fundamentos de Valor), uma nota de 0 a 10 calculada a partir de cinco indicadores fundamentalistas. Os dados são buscados automaticamente no Yahoo Finance e o ranking fica salvo no próprio navegador.

## Como o IFV é calculado

Cada indicador recebe uma nota de 1 a 5. O IFV é a média das notas multiplicada por 2.

| Nota | ROE (%) | P/L | P/VP | DY (%) | Dív. Líq./EBITDA |
|:----:|:-------:|:---:|:----:|:------:|:----------------:|
| 5 | ≥ 25 | ≤ 6 (e > 0) | ≤ 0,7 (e > 0) | ≥ 10 | ≤ 1 |
| 4 | 15–25 | 6–12 | 0,7–1 | 6–10 | 1–2 |
| 3 | 10–15 | 12–20 | 1–2 | 4–6 | 2–3 |
| 2 | 5–10 | 20–30 | 2–3 | 2–4 | 3–4 |
| 1 | < 5 | > 30 ou ≤ 0 | > 3 ou ≤ 0 | < 2 | > 4 |

P/L ou P/VP negativos (empresa com prejuízo ou patrimônio negativo) recebem nota 1.

**Dívida Líquida/EBITDA é opcional.** Para bancos, seguradoras e outras instituições financeiras o indicador não se aplica. Marque "Não se aplica" (o app marca sozinho quando o Yahoo classifica a empresa no setor financeiro) e o IFV passa a ser a média dos 4 indicadores restantes × 2, na mesma escala de 0 a 10.

| IFV | Classificação |
|:---:|---|
| ≥ 9 | Extraordinária |
| 7–9 | Muito boa |
| 5–7 | Razoável |
| 3–5 | Cara |
| < 3 | Muito cara |

## Estrutura

```
index.html     interface
style.css      estilos
app.js         lógica (cálculo, ranking, radar, import/export)
api/proxy.js   função serverless (Vercel) que consulta o Yahoo Finance
vercel.json    cabeçalhos de segurança
```

## Rodando localmente

```bash
npm i -g vercel
vercel dev
```

Abra `http://localhost:3000`. Sem a API (abrindo só o `index.html`) o app funciona, mas é preciso digitar os indicadores manualmente.

## Deploy

Basta importar o repositório na Vercel — a pasta `api/` vira a rota `/api/proxy` automaticamente.

## Backup dos dados

O ranking é salvo no `localStorage` do navegador. Use **Exportar** para baixar um JSON e **Importar** para restaurar (os scores são sempre recalculados na importação).

## Aviso

Projeto educacional. Os dados vêm do Yahoo Finance e podem estar incompletos ou defasados. Não é recomendação de investimento.
