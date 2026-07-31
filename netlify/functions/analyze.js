
function getRpcUrl() {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  if (process.env.HELIUS_API_KEY) {
    return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY)}`;
  }
  return "https://api.mainnet-beta.solana.com";
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function rpc(method, params) {
  const rpcUrl = getRpcUrl();
  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({jsonrpc: "2.0", id: `${method}-${attempt}`, method, params})
    });

    if (response.status === 429) {
      lastError = new Error("RPC rate limit reached");
      await wait(350 * (attempt + 1));
      continue;
    }

    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);

    const json = await response.json();
    if (json.error) {
      if (json.error.code === 429 || /rate/i.test(json.error.message || "")) {
        lastError = new Error(json.error.message || "RPC rate limit reached");
        await wait(350 * (attempt + 1));
        continue;
      }
      throw new Error(json.error.message || "RPC error");
    }
    return json.result;
  }

  throw lastError || new Error("RPC request failed");
}

exports.handler = async (event) => {
  try {
    const mint = event.queryStringParameters?.mint;
    if (!mint || mint.length < 32 || mint.length > 50) {
      return {statusCode: 400, body: JSON.stringify({error: "Invalid mint address."})};
    }

    // Sequential calls are intentional: they reduce burst-rate failures on free RPC plans.
    const account = await rpc("getAccountInfo", [mint, {encoding: "jsonParsed", commitment: "confirmed"}]);
    const supply = await rpc("getTokenSupply", [mint, {commitment: "confirmed"}]);
    const largest = await rpc("getTokenLargestAccounts", [mint, {commitment: "confirmed"}]);

    const info = account?.value?.data?.parsed?.info;
    if (!info) throw new Error("Mint account could not be parsed as an SPL token.");

    const rawSupply = BigInt(supply?.value?.amount || "0");
    const holders = (largest?.value || []).map(x => BigInt(x.amount || "0"));
    const top10Raw = holders.slice(0, 10).reduce((a, b) => a + b, 0n);
    const largestRaw = holders[0] || 0n;
    const percent = x => rawSupply > 0n ? Number(x * 1000000n / rawSupply) / 10000 : null;

    const top10Pct = percent(top10Raw);
    const largestPct = percent(largestRaw);
    const mintAuthority = info.mintAuthority || null;
    const freezeAuthority = info.freezeAuthority || null;

    let risk = 0;
    const notes = [];

    if (mintAuthority) {
      risk += 3;
      notes.push({level: "fail", text: "Mint authority is active; additional supply may be created."});
    } else notes.push({level: "pass", text: "Mint authority is revoked."});

    if (freezeAuthority) {
      risk += 3;
      notes.push({level: "fail", text: "Freeze authority is active; token accounts may be frozen."});
    } else notes.push({level: "pass", text: "Freeze authority is revoked."});

    if (top10Pct != null && top10Pct > 60) {
      risk += 3;
      notes.push({level: "fail", text: `Top 10 token accounts hold ${top10Pct.toFixed(2)}% of supply.`});
    } else if (top10Pct != null && top10Pct > 35) {
      risk += 1;
      notes.push({level: "warn", text: `Top 10 token accounts hold ${top10Pct.toFixed(2)}% of supply.`});
    } else {
      notes.push({level: "pass", text: `Top 10 token accounts hold ${top10Pct?.toFixed(2) ?? "--"}% of supply.`});
    }

    if (largestPct != null && largestPct > 25) {
      risk += 2;
      notes.push({level: "fail", text: `Largest token account holds ${largestPct.toFixed(2)}% of supply.`});
    } else {
      notes.push({level: "pass", text: `Largest token account holds ${largestPct?.toFixed(2) ?? "--"}% of supply.`});
    }

    notes.push({
      level: "warn",
      text: "Pools, lockers, exchanges, and related wallets can distort concentration figures."
    });

    return {
      statusCode: 200,
      headers: {"content-type": "application/json", "cache-control": "public,max-age=30"},
      body: JSON.stringify({
        mintAuthority,
        freezeAuthority,
        supply: supply.value,
        top10Pct,
        largestPct,
        riskLabel: risk >= 6 ? "HIGH" : risk >= 3 ? "MEDIUM" : "LOW",
        rpcProvider: process.env.HELIUS_API_KEY ? "Helius" : "Public Solana RPC",
        notes
      })
    };
  } catch (error) {
    const rateLimited = /429|rate limit/i.test(error.message || "");
    return {
      statusCode: rateLimited ? 429 : 500,
      body: JSON.stringify({
        error: rateLimited
          ? "RPC rate limit reached. Confirm HELIUS_API_KEY is saved, then redeploy the site."
          : error.message
      })
    };
  }
};
