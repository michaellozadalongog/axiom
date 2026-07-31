
const $ = s => document.querySelector(s);
const API = "https://api.dexscreener.com";
const AXIOM = "https://axiom.trade/";
let active = null;
let discovery = [];

const money = n => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "--";
  n = Number(n);
  if (n >= 1e9) return "$" + (n/1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n/1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n/1e3).toFixed(1) + "K";
  return "$" + n.toFixed(n < 1 ? 4 : 2);
};
const short = ca => ca ? ca.slice(0,6) + "…" + ca.slice(-6) : "--";
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const pct = v => Number.isFinite(Number(v)) ? `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}%` : "--";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function ageFrom(ts){
  if(!ts) return "--";
  const mins = Math.max(0, Math.floor((Date.now() - ts)/60000));
  if(mins < 60) return mins + "m";
  if(mins < 1440) return Math.floor(mins/60) + "h";
  return Math.floor(mins/1440) + "d";
}
function saveSettings(){
  localStorage.setItem("ah-settings", JSON.stringify({
    maxBuy: $("#maxBuy").value, dailyStop: $("#dailyStop").value, minLiquidity: $("#minLiquidity").value
  }));
}
function loadSettings(){
  try{
    const x=JSON.parse(localStorage.getItem("ah-settings")||"{}");
    if(x.maxBuy) $("#maxBuy").value=x.maxBuy;
    if(x.dailyStop) $("#dailyStop").value=x.dailyStop;
    if(x.minLiquidity) $("#minLiquidity").value=x.minLiquidity;
  }catch{}
}
["maxBuy","dailyStop","minLiquidity"].forEach(id => $("#"+id).addEventListener("change", saveSettings));

function choosePrimary(pairs, contract){
  const valid = pairs.filter(p => p.chainId === "solana");
  valid.sort((a,b) => num(b.liquidity?.usd) - num(a.liquidity?.usd));
  return valid.find(p => p.baseToken?.address === contract) || valid[0];
}
function scorePair(p){
  const liq=num(p.liquidity?.usd), mc=num(p.marketCap || p.fdv), vol5=num(p.volume?.m5);
  const buys=num(p.txns?.m5?.buys), sells=num(p.txns?.m5?.sells), total=buys+sells;
  const ratio=sells ? buys/sells : buys ? 3 : 0;
  const ch5=num(p.priceChange?.m5), ageMin=p.pairCreatedAt ? (Date.now()-p.pairCreatedAt)/60000 : 999999;
  let score=0, reasons=[];

  if(liq>=250000){score+=20;reasons.push("Strong liquidity for a newly discovered token (+20).")}
  else if(liq>=100000){score+=16;reasons.push("Usable liquidity, though exits can still slip (+16).")}
  else if(liq>=50000){score+=10;reasons.push("Liquidity clears the default minimum but remains thin (+10).")}
  else{score+=2;reasons.push("Very thin liquidity creates major exit risk (+2).")}

  if(vol5>=100000){score+=20;reasons.push("High five-minute volume (+20).")}
  else if(vol5>=25000){score+=14;reasons.push("Meaningful five-minute volume (+14).")}
  else if(vol5>=5000){score+=7;reasons.push("Some short-term activity (+7).")}
  else reasons.push("Little five-minute volume (+0).");

  if(total>=20 && ratio>=1.7){score+=15;reasons.push("Strong recent buy pressure (+15).")}
  else if(total>=10 && ratio>=1.15){score+=10;reasons.push("Buy pressure is positive (+10).")}
  else if(total<10){score+=2;reasons.push("Transaction sample is too small (+2).")}
  else reasons.push("Sells are matching or exceeding buys (+0).");

  if(mc>=300000 && mc<=5000000){score+=15;reasons.push("Market cap sits in the high-upside screening range (+15).")}
  else if(mc>5000000 && mc<=30000000){score+=10;reasons.push("Mid-small market cap still has room, but less asymmetry (+10).")}
  else if(mc>30000000){score+=4;reasons.push("Larger market cap reduces early-stage upside (+4).")}
  else{score+=3;reasons.push("Extremely small/unknown market cap raises manipulation risk (+3).")}

  if(ageMin>=15 && ageMin<=1440){score+=10;reasons.push("Pair is new but has survived beyond the first minutes (+10).")}
  else if(ageMin>1440 && ageMin<=10080){score+=7;reasons.push("Pair is one to seven days old (+7).")}
  else if(ageMin<15){score+=2;reasons.push("Pair is extremely new; price discovery is unstable (+2).")}
  else{score+=3;reasons.push("Older pair is less likely to be an undiscovered launch (+3).")}

  if(ch5>=3 && ch5<=25){score+=10;reasons.push("Positive five-minute momentum without an extreme spike (+10).")}
  else if(ch5>25){score+=3;reasons.push("Five-minute move may already be overheated (+3).")}
  else if(ch5>=0){score+=5;reasons.push("Price is stable to slightly positive (+5).")}
  else reasons.push("Negative five-minute momentum (+0).");

  return {score:Math.min(90,score), reasons, ratio, total, ageMin};
}
function checksFor(p, scoreData){
  const min=num($("#minLiquidity").value)||50000, liq=num(p.liquidity?.usd), mc=num(p.marketCap||p.fdv);
  const buys=num(p.txns?.m5?.buys), sells=num(p.txns?.m5?.sells);
  return [
    [liq>=min, liq>=min ? `Liquidity clears your ${money(min)} minimum` : `Liquidity is below your ${money(min)} minimum`],
    [scoreData.total>=10, scoreData.total>=10 ? "At least 10 transactions in the 5m sample" : "Very small 5m transaction sample"],
    [buys>sells, buys>sells ? "Recent buys exceed sells" : "Recent sells match or exceed buys"],
    [mc>0, mc>0 ? "Market-cap/FDV estimate is available" : "Market-cap data is unavailable"],
    [null, "Contract authorities and holder concentration remain unknown"]
  ];
}
function renderPair(p, contract){
  const s=scorePair(p);
  active={pair:p, contract, score:s.score};
  $("#errorBox").classList.add("hidden");
  const base = p.baseToken || {};
  $("#tokenName").textContent = `${base.name || "Unknown token"} (${base.symbol || "?"})`;
  $("#tokenMeta").textContent = contract;
  $("#score").textContent = s.score;
  $("#price").textContent = money(num(p.priceUsd));
  $("#marketCap").textContent = money(num(p.marketCap || p.fdv));
  $("#liquidity").textContent = money(num(p.liquidity?.usd));
  $("#volume").textContent = money(num(p.volume?.m5));
  $("#ratio").textContent = `${num(p.txns?.m5?.buys)} / ${num(p.txns?.m5?.sells)}`;
  $("#age").textContent = ageFrom(p.pairCreatedAt);
  $("#change5m").textContent = pct(p.priceChange?.m5);
  $("#change1h").textContent = pct(p.priceChange?.h1);
  $("#dex").textContent = p.dexId || "--";
  $("#change5m").className=num(p.priceChange?.m5)>=0?"positive":"negative";
  $("#change1h").className=num(p.priceChange?.h1)>=0?"positive":"negative";

  const img=p.info?.imageUrl;
  if(img){$("#coinImage").src=img;$("#coinImage").classList.remove("hidden");$("#coinFallback").classList.add("hidden")}
  else{$("#coinImage").classList.add("hidden");$("#coinFallback").classList.remove("hidden");$("#coinFallback").textContent=(base.symbol||"?")[0]}

  const links=[];
  if(p.url) links.push(`<a href="${esc(p.url)}" target="_blank" rel="noopener">DEX Screener</a>`);
  (p.info?.websites||[]).slice(0,1).forEach(x=>links.push(`<a href="${esc(x.url)}" target="_blank" rel="noopener">Website</a>`));
  (p.info?.socials||[]).slice(0,2).forEach(x=>links.push(`<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.type||"Social")}</a>`));
  $("#tokenLinks").innerHTML=links.join("");

  $("#checks").innerHTML=checksFor(p,s).map(([ok,text])=>`<div class="check ${ok===true?"pass":ok===false?"fail":"warn"}">${ok===true?"✓":ok===false?"✕":"!"} ${esc(text)}</div>`).join("");
  $("#reasons").innerHTML=s.reasons.map(x=>`<li>${esc(x)}</li>`).join("");
}
async function fetchToken(contract, silent=false){
  if(!silent) $("#loading").classList.remove("hidden");
  try{
    const r=await fetch(`${API}/token-pairs/v1/solana/${encodeURIComponent(contract)}`);
    if(!r.ok) throw new Error(`Data provider returned HTTP ${r.status}.`);
    const pairs=await r.json();
    if(!Array.isArray(pairs)||!pairs.length) throw new Error("No Solana liquidity pool was found for this contract.");
    const p=choosePrimary(pairs,contract);
    if(!p) throw new Error("No usable Solana pair was found.");
    renderPair(p,contract);
    return {pair:p,contract};
  }catch(e){
    if(!silent){
      $("#errorBox").textContent=e.message+" Check the contract address and try again.";
      $("#errorBox").classList.remove("hidden");
    }
    throw e;
  }finally{
    if(!silent) $("#loading").classList.add("hidden");
  }
}
async function analyze(){
  const ca=$("#contract").value.trim();
  if(ca.length<32 || ca.length>50) return showError("That does not look like a Solana token address.");
  try{await fetchToken(ca)}catch{}
}
function showError(msg){$("#errorBox").textContent=msg;$("#errorBox").classList.remove("hidden")}
function preview(side,amount){
  if(!active) return showError("Analyze or select a token first.");
  let size;
  if(side==="BUY"){
    const max=num($("#maxBuy").value)||10;
    let value=amount==="custom"?Number(prompt("Enter buy amount in USD:",max)):Number(amount);
    if(!value||value<=0)return;
    if(value>max&&!confirm(`This exceeds your $${max} max-buy guardrail. Continue to preview?`))return;
    size="$"+value.toFixed(2);
  }else size=amount+"%";
  $("#orderTitle").textContent=`${side} order preview`;
  $("#orderBody").innerHTML=`<strong>${esc(active.pair.baseToken?.symbol||"TOKEN")}</strong><br>Size: ${esc(size)}<br>Contract: <span class="mono">${esc(active.contract)}</span><br><br><b>No transaction occurs on this website.</b> The address will be copied and Axiom will open in a new tab.`;
  $("#verifyCheck").checked=false;$("#continueAxiom").disabled=true;$("#orderDialog").showModal();
}
async function copyActive(){
  if(!active)return showError("Analyze a token first.");
  try{await navigator.clipboard.writeText(active.contract);alert("Contract copied.")}catch{prompt("Copy this contract:",active.contract)}
}
$("#verifyCheck").onchange=e=>$("#continueAxiom").disabled=!e.target.checked;
$("#continueAxiom").onclick=async()=>{if(active){try{await navigator.clipboard.writeText(active.contract)}catch{}window.open(AXIOM,"_blank","noopener")}};
$("#analyzeBtn").onclick=analyze;
$("#contract").addEventListener("keydown",e=>{if(e.key==="Enter")analyze()});
$("#axiomBtn").onclick=()=>window.open(AXIOM,"_blank","noopener");
$("#copyCa").onclick=copyActive;
document.querySelectorAll("[data-buy]").forEach(b=>b.onclick=()=>preview("BUY",b.dataset.buy));
document.querySelectorAll("[data-sell]").forEach(b=>b.onclick=()=>preview("SELL",b.dataset.sell));

async function loadDiscovery(){
  $("#watchRows").innerHTML='<tr><td colspan="7" class="muted">Loading live feed…</td></tr>';
  try{
    const r=await fetch(`${API}/token-boosts/latest/v1`);
    if(!r.ok)throw new Error("Boost feed unavailable.");
    const boosts=(await r.json()).filter(x=>x.chainId==="solana").slice(0,12);
    const results=[];
    for(let i=0;i<boosts.length;i+=4){
      const batch=boosts.slice(i,i+4);
      const settled=await Promise.allSettled(batch.map(x=>fetchToken(x.tokenAddress,true)));
      settled.forEach((x,j)=>{if(x.status==="fulfilled")results.push(x.value)});
    }
    const unique=new Map();
    results.forEach(x=>unique.set(x.contract,x));
    discovery=[...unique.values()].sort((a,b)=>scorePair(b.pair).score-scorePair(a.pair).score).slice(0,10);
    renderDiscovery();
  }catch(e){
    $("#watchRows").innerHTML=`<tr><td colspan="7" class="negative">${esc(e.message)} Try again shortly.</td></tr>`;
  }
}
function renderDiscovery(){
  if(!discovery.length){$("#watchRows").innerHTML='<tr><td colspan="7" class="muted">No usable Solana pairs returned.</td></tr>';return}
  $("#watchRows").innerHTML=discovery.map(x=>{
    const p=x.pair,s=scorePair(p),b=p.baseToken||{};
    return `<tr><td><strong>${esc(b.symbol||"?")}</strong><span class="muted">${esc(b.name||"Unknown")}</span></td>
    <td>${s.score}</td><td>${money(num(p.marketCap||p.fdv))}</td><td>${money(num(p.liquidity?.usd))}</td>
    <td>${num(p.txns?.m5?.buys)}B / ${num(p.txns?.m5?.sells)}S</td><td>${ageFrom(p.pairCreatedAt)}</td>
    <td><button class="secondary mini select-token" data-ca="${esc(x.contract)}">Analyze</button></td></tr>`;
  }).join("");
  document.querySelectorAll(".select-token").forEach(b=>b.onclick=async()=>{$("#contract").value=b.dataset.ca;await fetchToken(b.dataset.ca);window.scrollTo({top:0,behavior:"smooth"})});
}
$("#refreshBtn").onclick=loadDiscovery;

function journal(){
  try{return JSON.parse(localStorage.getItem("ah-journal")||"[]")}catch{return[]}
}
function renderJournal(){
  const rows=journal();
  $("#journalRows").innerHTML=rows.length?rows.map(x=>`<tr><td>${esc(new Date(x.time).toLocaleString())}</td><td><strong>${esc(x.symbol)}</strong></td><td>${money(x.price)}</td><td>${x.score}</td><td>${money(x.liquidity)}</td><td class="mono">${esc(short(x.contract))}</td></tr>`).join(""):'<tr><td colspan="6" class="muted">No paper entries yet.</td></tr>';
}
$("#paperEntry").onclick=()=>{
  if(!active)return showError("Analyze a token first.");
  const p=active.pair, rows=journal();
  rows.unshift({time:Date.now(),symbol:p.baseToken?.symbol||"?",price:num(p.priceUsd),score:active.score,liquidity:num(p.liquidity?.usd),contract:active.contract});
  localStorage.setItem("ah-journal",JSON.stringify(rows.slice(0,100)));renderJournal();alert("Paper entry recorded.");
};
$("#clearJournal").onclick=()=>{if(confirm("Clear all paper entries saved in this browser?")){localStorage.removeItem("ah-journal");renderJournal()}};

loadSettings();renderJournal();loadDiscovery();


function formatSupply(amount, decimals){
  const n = Number(amount) / Math.pow(10, Number(decimals||0));
  return Number.isFinite(n) ? n.toLocaleString(undefined,{maximumFractionDigits:4}) : "--";
}
async function runSafety(){
  if(!active) return showError("Analyze a token first.");
  $("#runSafety").disabled=true;
  $("#runSafety").textContent="Scanning…";
  try{
    const r=await fetch(`/.netlify/functions/analyze?mint=${encodeURIComponent(active.contract)}`);
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"Safety scan failed.");
    $("#mintAuthority").textContent=data.mintAuthority ? "ACTIVE" : "Revoked";
    $("#freezeAuthority").textContent=data.freezeAuthority ? "ACTIVE" : "Revoked";
    $("#tokenSupply").textContent=formatSupply(data.supply?.amount,data.supply?.decimals);
    $("#top10").textContent=data.top10Pct==null?"--":data.top10Pct.toFixed(2)+"%";
    $("#largestHolder").textContent=data.largestPct==null?"--":data.largestPct.toFixed(2)+"%";
    $("#chainRisk").textContent=data.riskLabel;
    $("#chainRisk").className=data.riskLabel==="HIGH"?"negative":data.riskLabel==="LOW"?"positive":"";
    $("#safetyNotes").innerHTML=data.notes.map(n=>`<div class="check ${n.level==="pass"?"pass":n.level==="fail"?"fail":"warn"}">${n.level==="pass"?"✓":n.level==="fail"?"✕":"!"} ${esc(n.text)}</div>`).join("");
  }catch(e){
    $("#safetyNotes").innerHTML=`<div class="check fail">✕ ${esc(e.message)}</div>`;
  }finally{
    $("#runSafety").disabled=false;
    $("#runSafety").textContent="Run full safety scan";
  }
}
$("#runSafety").onclick=runSafety;

async function loadWallet(){
  const wallet=$("#walletAddress").value.trim();
  if(wallet.length<32||wallet.length>50){$("#walletStatus").textContent="Enter a valid-looking Solana wallet.";return}
  $("#watchWallet").disabled=true;$("#walletStatus").textContent="Loading real enhanced transactions…";
  try{
    const r=await fetch(`/.netlify/functions/wallet?address=${encodeURIComponent(wallet)}`);
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"Wallet lookup failed.");
    $("#walletStatus").textContent=`Loaded ${data.transactions.length} recent transactions.`;
    $("#walletRows").innerHTML=data.transactions.length?data.transactions.map(t=>`<tr>
      <td>${esc(new Date(t.timestamp*1000).toLocaleString())}</td>
      <td>${esc(t.type||"UNKNOWN")}</td>
      <td>${esc(t.description||"No parsed description")}</td>
      <td><a href="https://solscan.io/tx/${esc(t.signature)}" target="_blank" rel="noopener">${esc(short(t.signature))}</a></td>
    </tr>`).join(""):'<tr><td colspan="4" class="muted">No recent parsed transactions.</td></tr>';
  }catch(e){
    $("#walletStatus").textContent=e.message;
    $("#walletRows").innerHTML=`<tr><td colspan="4" class="negative">${esc(e.message)}</td></tr>`;
  }finally{$("#watchWallet").disabled=false}
}
$("#watchWallet").onclick=loadWallet;

let autoTimer=null,autoRunning=false,autoStats={checked:0,qualified:0};const alerted=new Set();function aset(){return{minScore:+$("#autoMinScore").value||65,minLiquidity:+$("#autoMinLiquidity").value||50000,maxTop10:+$("#autoMaxTop10").value||45,interval:+$("#autoInterval").value||60}}function saveAS(){localStorage.setItem("ah-auto",JSON.stringify(aset()))}function loadAS(){try{const s=JSON.parse(localStorage.getItem("ah-auto")||"{}");if(s.minScore!=null)$("#autoMinScore").value=s.minScore;if(s.minLiquidity!=null)$("#autoMinLiquidity").value=s.minLiquidity;if(s.maxTop10!=null)$("#autoMaxTop10").value=s.maxTop10;if(s.interval)$("#autoInterval").value=String(s.interval)}catch{}}["autoMinScore","autoMinLiquidity","autoMaxTop10","autoInterval"].forEach(id=>$("#"+id).onchange=()=>{saveAS();scheduleAuto()});$("#notifyBtn").onclick=async()=>{if(!("Notification"in window))return alert("Notifications are unavailable in this browser.");const p=await Notification.requestPermission();$("#notifyBtn").textContent=p==="granted"?"Notifications enabled":"Enable notifications"};async function leads(){const r=await fetch(`${API}/token-boosts/latest/v1`);if(!r.ok)throw new Error(`Discovery HTTP ${r.status}`);const bs=(await r.json()).filter(x=>x.chainId==="solana").slice(0,18),out=[];for(let i=0;i<bs.length;i+=6){const q=await Promise.allSettled(bs.slice(i,i+6).map(async b=>{const x=await fetch(`${API}/token-pairs/v1/solana/${encodeURIComponent(b.tokenAddress)}`);if(!x.ok)throw 0;const ps=await x.json(),p=choosePrimary(Array.isArray(ps)?ps:[],b.tokenAddress);if(!p)throw 0;return{contract:b.tokenAddress,pair:p}}));q.forEach(x=>x.status==="fulfilled"&&out.push(x.value))}return [...new Map(out.map(x=>[x.contract,x])).values()]}async function safety(mints){const r=await fetch("/.netlify/functions/batch-safety",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mints})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Safety scan failed");return new Map((d.results||[]).map(x=>[x.mint,x]))}function decide(c,s,o){const p=c.pair,sc=scorePair(p).score,l=num(p.liquidity?.usd),auth=!!s&&!s.error&&!s.mintAuthority&&!s.freezeAuthority,conc=!!s&&!s.error&&s.top10Pct!=null&&s.top10Pct<=o.maxTop10,market=sc>=o.minScore&&l>=o.minLiquidity,q=market&&auth&&conc;let d=q?"QUALIFIED":market&&(!s||s.error)?"WATCH":"REJECT",why=[];if(sc<o.minScore)why.push("score");if(l<o.minLiquidity)why.push("liquidity");if(!s||s.error)why.push("safety unavailable");else{if(s.mintAuthority)why.push("mint authority");if(s.freezeAuthority)why.push("freeze authority");if(!conc)why.push("concentration")}return{contract:c.contract,symbol:p.baseToken?.symbol||"?",name:p.baseToken?.name||"Unknown",score:sc,liquidity:l,top10Pct:s?.top10Pct,authoritiesSafe:auth,decision:d,reason:why.join(", ")}}function renderAuto(xs){if(!xs.length)return $("#autoRows").innerHTML='<tr><td colspan="7" class="muted">No candidates returned.</td></tr>';const ord={QUALIFIED:0,WATCH:1,REJECT:2};xs.sort((a,b)=>ord[a.decision]-ord[b.decision]||b.score-a.score);$("#autoRows").innerHTML=xs.map(x=>`<tr><td><strong>${esc(x.symbol)}</strong><span class="muted">${esc(x.name)}</span></td><td>${x.score}</td><td>${money(x.liquidity)}</td><td>${x.top10Pct==null?"--":x.top10Pct.toFixed(2)+"%"}</td><td>${x.authoritiesSafe?"Revoked":"Risk/unknown"}</td><td><span class="${x.decision==="QUALIFIED"?"decision-pass":x.decision==="WATCH"?"decision-watch":"decision-fail"}">${x.decision}</span><span class="muted">${esc(x.reason)}</span></td><td><button class="secondary mini auto-open" data-ca="${esc(x.contract)}">Open Axiom</button></td></tr>`).join("");document.querySelectorAll(".auto-open").forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.ca)}catch{}window.open(AXIOM,"_blank","noopener")})}async function scanAuto(){if(!autoRunning)return;$("#autoStatus").textContent="Scanning…";try{const o=aset(),cs=await leads(),top=cs.map(c=>({c,s:scorePair(c.pair).score})).filter(x=>x.s>=Math.max(40,o.minScore-20)).sort((a,b)=>b.s-a.s).slice(0,5).map(x=>x.c),sm=top.length?await safety(top.map(x=>x.contract)):new Map(),rows=top.map(c=>decide(c,sm.get(c.contract),o)),qs=rows.filter(x=>x.decision==="QUALIFIED");autoStats.checked+=rows.length;autoStats.qualified+=qs.length;$("#autoChecked").textContent=autoStats.checked;$("#autoQualified").textContent=autoStats.qualified;$("#lastAutoScan").textContent=new Date().toLocaleTimeString();$("#autoStatus").textContent=`Running • next in ${o.interval}s`;renderAuto(rows);if(Notification.permission==="granted")qs.forEach(x=>{if(!alerted.has(x.contract)){alerted.add(x.contract);new Notification(`AlphaHunter: ${x.symbol}`,{body:`Score ${x.score} • ${money(x.liquidity)} liquidity`,tag:x.contract})}})}catch(e){$("#autoStatus").textContent="Error";$("#autoRows").innerHTML=`<tr><td colspan="7" class="negative">${esc(e.message)}</td></tr>`}finally{scheduleAuto()}}function scheduleAuto(){clearTimeout(autoTimer);if(autoRunning)autoTimer=setTimeout(scanAuto,aset().interval*1000)}$("#toggleAuto").onclick=()=>{autoRunning=!autoRunning;$("#toggleAuto").textContent=autoRunning?"Stop Auto Scout":"Start Auto Scout";$("#autoStatus").textContent=autoRunning?"Starting…":"Stopped";clearTimeout(autoTimer);if(autoRunning)scanAuto()};loadAS();


function evidenceReturn(value) {
  if (!Number.isFinite(Number(value))) return "--";
  const number = Number(value);
  return `<span class="${number >= 0 ? "return-positive" : "return-negative"}">${number >= 0 ? "+" : ""}${number.toFixed(2)}%</span>`;
}
function formatEvidenceTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString() : "--";
}
async function loadEvidence() {
  $("#evidenceMessage").className = "check neutral";
  $("#evidenceMessage").textContent = "Loading cloud evidence…";
  try {
    const response = await fetch("/.netlify/functions/evidence?limit=100", {cache: "no-store"});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Evidence endpoint failed.");

    $("#storedSignals").textContent = data.storedSignals;
    $("#measuredSignals").textContent = data.measuredSignals;
    $("#winRate30").innerHTML = evidenceReturn(data.winRate30);
    $("#avgReturn30").innerHTML = evidenceReturn(data.averageReturn30);
    $("#bestReturn").innerHTML = evidenceReturn(data.bestReturn);
    $("#lastCloudScan").textContent = data.lastScanAt ? new Date(data.lastScanAt).toLocaleTimeString() : "--";

    const enough = data.measuredSignals >= 100;
    $("#evidenceMessage").className = `check ${enough ? "pass" : "warn"}`;
    $("#evidenceMessage").textContent = enough
      ? `${data.measuredSignals} measured 30-minute outcomes are available. This is enough to begin segmented analysis, but not proof of a durable edge.`
      : `${data.measuredSignals} measured 30-minute outcomes so far. Collect at least 100 before drawing even preliminary conclusions.`;

    $("#evidenceRows").innerHTML = data.signals.length ? data.signals.map(signal => `
      <tr>
        <td>${esc(formatEvidenceTime(signal.detectedAt))}</td>
        <td><strong>${esc(signal.symbol)}</strong><span class="muted">${esc(signal.name)}</span></td>
        <td>${money(signal.entryMarketCap)}</td>
        <td>${signal.score}</td>
        <td>${evidenceReturn(signal.outcomes?.m30?.returnPct)}</td>
        <td>${evidenceReturn(signal.outcomes?.h1?.returnPct)}</td>
        <td>${evidenceReturn(signal.outcomes?.h4?.returnPct)}</td>
        <td>${evidenceReturn(signal.outcomes?.h24?.returnPct)}</td>
        <td>${signal.entryLiquidity >= 50000 ? "Market pass" : "Thin liquidity"}</td>
      </tr>`).join("") :
      '<tr><td colspan="9" class="muted">No cloud signals stored yet. Run the first scan.</td></tr>';
  } catch (error) {
    $("#evidenceMessage").className = "check fail";
    $("#evidenceMessage").textContent = error.message;
  }
}
async function triggerCloudScan() {
  $("#runCloudScan").disabled = true;
  $("#runCloudScan").textContent = "Scanning…";
  try {
    const response = await fetch("/.netlify/functions/cloud-scan");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Cloud scan failed.");
    await loadEvidence();
    alert(`Cloud scan complete: ${data.added} new signals, ${data.stored} stored.`);
  } catch (error) {
    $("#evidenceMessage").className = "check fail";
    $("#evidenceMessage").textContent = error.message;
  } finally {
    $("#runCloudScan").disabled = false;
    $("#runCloudScan").textContent = "Run scan now";
  }
}
$("#refreshEvidence").onclick = loadEvidence;
$("#runCloudScan").onclick = triggerCloudScan;
loadEvidence();
