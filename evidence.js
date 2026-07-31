
const { getStore } = require("@netlify/blobs");
const { STORE_NAME, DATA_KEY } = require("./evidence-shared");

function summarize(signals) {
  const measured30 = signals.filter(signal => Number.isFinite(signal.outcomes?.m30?.returnPct));
  const returns30 = measured30.map(signal => signal.outcomes.m30.returnPct);
  const allMeasured = signals.flatMap(signal =>
    Object.values(signal.outcomes || {})
      .map(outcome => outcome?.returnPct)
      .filter(Number.isFinite)
  );

  return {
    storedSignals: signals.length,
    measuredSignals: measured30.length,
    winRate30: returns30.length
      ? returns30.filter(value => value > 0).length / returns30.length * 100
      : null,
    averageReturn30: returns30.length
      ? returns30.reduce((sum, value) => sum + value, 0) / returns30.length
      : null,
    bestReturn: allMeasured.length ? Math.max(...allMeasured) : null
  };
}

exports.handler = async event => {
  try {
    const store = getStore({name: STORE_NAME, consistency: "strong"});
    const dataset = await store.get(DATA_KEY, {type: "json", consistency: "strong"}) ||
      {signals: [], lastScanAt: null};

    const limit = Math.min(200, Math.max(1, Number(event.queryStringParameters?.limit || 100)));
    return {
      statusCode: 200,
      headers: {"content-type": "application/json", "cache-control": "no-store"},
      body: JSON.stringify({
        ...summarize(dataset.signals || []),
        lastScanAt: dataset.lastScanAt || null,
        lastNewSignalCount: dataset.lastNewSignalCount || 0,
        signals: (dataset.signals || []).slice(0, limit)
      })
    };
  } catch (error) {
    return {statusCode: 500, body: JSON.stringify({error: error.message})};
  }
};
