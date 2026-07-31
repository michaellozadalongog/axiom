
function shortAddress(value = "") {
  return value.length > 12 ? `${value.slice(0, 5)}…${value.slice(-5)}` : value;
}

function amountText(transfer) {
  const amount = transfer?.tokenAmount ?? transfer?.amount;
  if (amount == null) return "";
  const numeric = Number(amount);
  return Number.isFinite(numeric)
    ? numeric.toLocaleString(undefined, {maximumFractionDigits: 6})
    : String(amount);
}

function buildDescription(tx, watchedAddress) {
  if (tx.description) return tx.description;

  const tokenTransfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
  const nativeTransfers = Array.isArray(tx.nativeTransfers) ? tx.nativeTransfers : [];

  const incoming = tokenTransfers.filter(t => t.toUserAccount === watchedAddress);
  const outgoing = tokenTransfers.filter(t => t.fromUserAccount === watchedAddress);

  if (tx.type === "SWAP" || (incoming.length && outgoing.length)) {
    const sold = outgoing[0];
    const bought = incoming[0];
    if (sold && bought) {
      return `Swapped ${amountText(sold)} ${shortAddress(sold.mint)} for ${amountText(bought)} ${shortAddress(bought.mint)}`;
    }
    if (bought) return `Received ${amountText(bought)} tokens (${shortAddress(bought.mint)}) in a swap`;
    if (sold) return `Sent ${amountText(sold)} tokens (${shortAddress(sold.mint)}) in a swap`;
  }

  if (incoming[0]) {
    return `Received ${amountText(incoming[0])} tokens (${shortAddress(incoming[0].mint)})`;
  }
  if (outgoing[0]) {
    return `Sent ${amountText(outgoing[0])} tokens (${shortAddress(outgoing[0].mint)})`;
  }

  const nativeIn = nativeTransfers.find(t => t.toUserAccount === watchedAddress);
  const nativeOut = nativeTransfers.find(t => t.fromUserAccount === watchedAddress);
  if (nativeIn) return `Received ${(Number(nativeIn.amount || 0) / 1e9).toFixed(4)} SOL`;
  if (nativeOut) return `Sent ${(Number(nativeOut.amount || 0) / 1e9).toFixed(4)} SOL`;

  return `${tx.type || "Transaction"} via ${tx.source || "unknown source"}`;
}

exports.handler = async (event) => {
  try {
    const address = event.queryStringParameters?.address;
    const key = process.env.HELIUS_API_KEY;

    if (!key) {
      return {statusCode: 503, body: JSON.stringify({
        error: "HELIUS_API_KEY is not configured in Netlify yet."
      })};
    }
    if (!address || address.length < 32 || address.length > 50) {
      return {statusCode: 400, body: JSON.stringify({error: "Invalid wallet address."})};
    }

    const url = `https://api-mainnet.helius-rpc.com/v0/addresses/${encodeURIComponent(address)}/transactions?api-key=${encodeURIComponent(key)}&limit=25`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || data?.message || `Helius HTTP ${response.status}`);
    }

    const transactions = (Array.isArray(data) ? data : []).map(tx => ({
      signature: tx.signature,
      timestamp: tx.timestamp,
      type: tx.type,
      source: tx.source,
      description: buildDescription(tx, address)
    }));

    return {
      statusCode: 200,
      headers: {"content-type": "application/json", "cache-control": "no-store"},
      body: JSON.stringify({transactions})
    };
  } catch (error) {
    return {statusCode: 500, body: JSON.stringify({error: error.message})};
  }
};
