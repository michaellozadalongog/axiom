
const API = "https://api.dexscreener.com";
const STORE_NAME = "alphahunter-evidence";
const DATA_KEY = "signals-v1";

const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function choosePrimary(pairs, contract) {
  const valid = (Array.isArray(pairs) ? pairs : []).filter(pair => pair.chainId === "solana");
  valid.sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd));
  return valid.find(pair => pair.baseToken?.address === contract) || valid[0] || null;
}

function scorePair(pair) {
  const liquidity = num(pair.liquidity?.usd);
  const marketCap = num(pair.marketCap || pair.fdv);
  const volume5m = num(pair.volume?.m5);
  const buys = num(pair.txns?.m5?.buys);
  const sells = num(pair.txns?.m5?.sells);
  const total = buys + sells;
  const ratio = sells ? buys / sells : buys ? 3 : 0;
  const change5m = num(pair.priceChange?.m5);
  const ageMinutes = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 60000 : 999999;
  let score = 0;

  score += liquidity >= 250000 ? 20 : liquidity >= 100000 ? 16 : liquidity >= 50000 ? 10 : 2;
  score += volume5m >= 100000 ? 20 : volume5m >= 25000 ? 14 : volume5m >= 5000 ? 7 : 0;
  score += total >= 20 && ratio >= 1.7 ? 15 : total >= 10 && ratio >= 1.15 ? 10 : total < 10 ? 2 : 0;
  score += marketCap >= 300000 && marketCap <= 5000000 ? 15 :
    marketCap > 5000000 && marketCap <= 30000000 ? 10 : marketCap > 30000000 ? 4 : 3;
  score += ageMinutes >= 15 && ageMinutes <= 1440 ? 10 :
    ageMinutes > 1440 && ageMinutes <= 10080 ? 7 : ageMinutes < 15 ? 2 : 3;
  score += change5m >= 3 && change5m <= 25 ? 10 : change5m > 25 ? 3 : change5m >= 0 ? 5 : 0;

  return Math.min(90, score);
}

async function fetchPair(contract) {
  const response = await fetch(`${API}/token-pairs/v1/solana/${encodeURIComponent(contract)}`);
  if (!response.ok) throw new Error(`DEX Screener pair HTTP ${response.status}`);
  return choosePrimary(await response.json(), contract);
}

async function discoverCandidates() {
  const response = await fetch(`${API}/token-boosts/latest/v1`);
  if (!response.ok) throw new Error(`DEX Screener discovery HTTP ${response.status}`);

  const boosts = (await response.json())
    .filter(item => item.chainId === "solana")
    .slice(0, 20);

  const candidates = [];
  for (let i = 0; i < boosts.length; i += 5) {
    const settled = await Promise.allSettled(
      boosts.slice(i, i + 5).map(async item => ({
        contract: item.tokenAddress,
        pair: await fetchPair(item.tokenAddress)
      }))
    );
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value.pair) candidates.push(result.value);
    }
    await wait(120);
  }

  const unique = new Map();
  for (const candidate of candidates) unique.set(candidate.contract, candidate);
  return [...unique.values()];
}

function returnPct(entry, current) {
  if (!entry || !current) return null;
  return ((current - entry) / entry) * 100;
}

module.exports = {
  API, STORE_NAME, DATA_KEY, num, wait, choosePrimary, scorePair,
  fetchPair, discoverCandidates, returnPct
};
