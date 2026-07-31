
const { getStore } = require("@netlify/blobs");
const {
  STORE_NAME, DATA_KEY, num, scorePair, fetchPair, discoverCandidates, returnPct, wait
} = require("./evidence-shared");

const WINDOWS = [
  {key: "m30", milliseconds: 30 * 60 * 1000},
  {key: "h1", milliseconds: 60 * 60 * 1000},
  {key: "h4", milliseconds: 4 * 60 * 60 * 1000},
  {key: "h24", milliseconds: 24 * 60 * 60 * 1000}
];

async function readDataset(store) {
  const data = await store.get(DATA_KEY, {type: "json", consistency: "strong"});
  return data && Array.isArray(data.signals) ? data : {signals: [], lastScanAt: null};
}

async function updateOutcomes(signals) {
  const now = Date.now();
  const due = signals.filter(signal =>
    WINDOWS.some(window => !signal.outcomes?.[window.key] && now - signal.detectedAt >= window.milliseconds)
  ).slice(0, 12);

  for (const signal of due) {
    try {
      const pair = await fetchPair(signal.contract);
      if (!pair) continue;
      const currentPrice = num(pair.priceUsd);
      signal.outcomes ||= {};
      for (const window of WINDOWS) {
        if (!signal.outcomes[window.key] && now - signal.detectedAt >= window.milliseconds) {
          signal.outcomes[window.key] = {
            measuredAt: now,
            price: currentPrice,
            marketCap: num(pair.marketCap || pair.fdv),
            returnPct: returnPct(signal.entryPrice, currentPrice)
          };
        }
      }
    } catch (error) {
      signal.lastOutcomeError = error.message;
    }
    await wait(100);
  }
}

async function scan() {
  const store = getStore({name: STORE_NAME, consistency: "strong"});
  const dataset = await readDataset(store);
  await updateOutcomes(dataset.signals);

  const candidates = await discoverCandidates();
  const existing = new Set(dataset.signals.map(signal => signal.contract));
  const newSignals = [];

  for (const candidate of candidates) {
    const pair = candidate.pair;
    const score = scorePair(pair);
    const liquidity = num(pair.liquidity?.usd);
    const marketCap = num(pair.marketCap || pair.fdv);
    const ageMinutes = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 60000 : null;

    // Cloud evidence threshold: intentionally broader than "qualified" so rejected
    // and marginal setups can also be evaluated later.
    if (score < 45 || liquidity < 20000 || existing.has(candidate.contract)) continue;

    const signal = {
      id: `${candidate.contract}-${Date.now()}`,
      contract: candidate.contract,
      symbol: pair.baseToken?.symbol || "?",
      name: pair.baseToken?.name || "Unknown",
      detectedAt: Date.now(),
      pairCreatedAt: pair.pairCreatedAt || null,
      ageMinutes,
      entryPrice: num(pair.priceUsd),
      entryMarketCap: marketCap,
      entryLiquidity: liquidity,
      volume5m: num(pair.volume?.m5),
      buys5m: num(pair.txns?.m5?.buys),
      sells5m: num(pair.txns?.m5?.sells),
      score,
      dexId: pair.dexId || null,
      outcomes: {}
    };
    dataset.signals.unshift(signal);
    newSignals.push(signal);
    existing.add(candidate.contract);
  }

  // Keep a practical evidence window in this lightweight store.
  dataset.signals = dataset.signals.slice(0, 750);
  dataset.lastScanAt = Date.now();
  dataset.lastNewSignalCount = newSignals.length;
  await store.setJSON(DATA_KEY, dataset);

  return {stored: dataset.signals.length, added: newSignals.length, lastScanAt: dataset.lastScanAt};
}

exports.handler = async () => {
  try {
    const result = await scan();
    return {statusCode: 200, body: JSON.stringify(result)};
  } catch (error) {
    console.error(error);
    return {statusCode: 500, body: JSON.stringify({error: error.message})};
  }
};
