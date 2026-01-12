import "./style.css";
import { BrowserProvider, Contract, formatEther, formatUnits } from "ethers";
import { initReownAppKit } from "./reown.js";

// =========================
// CONFIG
// =========================
const LINEA_CHAIN_ID_DEC = 59144;
const LINEA_CHAIN_ID_HEX = "0xE708";

const DUST_CONTRACT_ADDRESS = "0xF312Ec9f8087C87fbF3439B0369eA233a1EE4A7D";
const MIN_ETH_REQUIRED = "0.001";

const DUST_ABI = [
  "function claimDaily() external",
  "function canClaim(address user) view returns (bool ok, string reason)",
  "function nextClaimTime(address user) view returns (uint256)",
  "function windowEndTime(address user) view returns (uint256)",
  "function firstClaimAt(address user) view returns (uint256)",
  "function cap() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)"
];

// =========================
// UI (render immediately)
// =========================
document.querySelector("#app").innerHTML = `
  <div class="wrap">
    <div class="card">
      <div class="title">Claim your daily DUST</div>
      <div class="muted">Linea mainnet · 5 DUST per day · 6 months per wallet</div>

      <div class="note">
        Minimum requirement: wallet must hold at least <b id="minEthLabel">${MIN_ETH_REQUIRED} ETH</b> to claim.
        <span class="muted">(Your balance: <span id="ethBal">—</span>)</span>
        <div class="tip"><b>Tip:</b> Use “Connect wallet” to open AppKit / WalletConnect.</div>
      </div>

      <div class="spacer"></div>

      <div class="btn-row">
        <button id="connectBtn" class="btn btn-secondary">Connect wallet</button>
        <button id="switchBtn" class="btn btn-secondary" disabled>Switch to Linea</button>
      </div>

      <div class="spacer"></div>

      <div class="row"><div class="muted">Wallet</div><div id="wallet" class="muted value">Not connected</div></div>
      <div class="row"><div class="muted">Network</div><div id="network" class="muted value">—</div></div>
      <div class="row"><div class="muted">Can claim now</div><div id="canClaim" class="pill">—</div></div>
      <div class="row"><div class="muted">Next claim</div><div id="nextClaim" class="muted value">—</div></div>
      <div class="row"><div class="muted">Window ends</div><div id="windowEnds" class="muted value">—</div></div>
      <div class="row"><div class="muted">Remaining supply</div><div id="remaining" class="muted value">—</div></div>

      <div class="spacer"></div>

      <button id="claimBtn" class="btn btn-primary" disabled>Claim 5 DUST</button>
      <button id="disconnectBtn" class="btn btn-secondary" style="margin-top:10px; display:none;">Disconnect</button>

      <div id="msg" class="ok" style="display:none;"></div>
      <div id="err" class="err" style="display:none;"></div>
    </div>
  </div>
`;

const $ = (id) => document.getElementById(id);

function setMsg(text) {
  $("msg").style.display = "block";
  $("err").style.display = "none";
  $("msg").textContent = text;
}
function setErr(text) {
  $("err").style.display = "block";
  $("msg").style.display = "none";
  $("err").textContent = text;
}
function clearAlerts() {
  $("msg").style.display = "none";
  $("err").style.display = "none";
  $("msg").textContent = "";
  $("err").textContent = "";
}
function shortAddr(a) {
  return a ? a.slice(0, 6) + "…" + a.slice(-4) : "—";
}
function fmtTime(ts) {
  if (!ts || ts === 0) return "—";
  return new Date(Number(ts) * 1000).toLocaleString();
}
function pad2(n) { return String(n).padStart(2, "0"); }
function formatCountdown(secondsLeft) {
  if (secondsLeft <= 0) return "Ready now";
  const h = Math.floor(secondsLeft / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = Math.floor(secondsLeft % 60);
  return `Claim in: ${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

// =========================
// Reown AppKit init
// =========================
const { appKit, error: reownError } = initReownAppKit();
if (reownError) setErr(reownError);

// =========================
// State
// =========================
let eip1193 = null;
let user = null;
let ethersProvider = null;
let signer = null;
let contract = null;
let decimals = 18;

let countdownInterval = null;
let latestNextClaimAt = 0;
let latestCanClaimNow = false;

function stopCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
}

function resetUiDisconnected() {
  $("wallet").textContent = "Not connected";
  $("network").textContent = "—";
  $("canClaim").textContent = "—";
  $("nextClaim").textContent = "—";
  $("windowEnds").textContent = "—";
  $("remaining").textContent = "—";
  $("ethBal").textContent = "—";
  $("disconnectBtn").style.display = "none";
  $("claimBtn").disabled = true;
  $("switchBtn").disabled = true;
  stopCountdown();

  eip1193 = null;
  user = null;
  ethersProvider = null;
  signer = null;
  contract = null;
  decimals = 18;
}

async function rebuildEthers() {
  if (!eip1193 || !user) return;

  ethersProvider = new BrowserProvider(eip1193);
  signer = await ethersProvider.getSigner();
  contract = new Contract(DUST_CONTRACT_ADDRESS, DUST_ABI, signer);

  try { decimals = await contract.decimals(); } catch { decimals = 18; }
}

async function updateNetworkLabel() {
  if (!ethersProvider) { $("network").textContent = "—"; return; }
  try {
    const net = await ethersProvider.getNetwork();
    const isLinea = Number(net.chainId) === LINEA_CHAIN_ID_DEC;
    $("network").textContent = `${net.chainId}${isLinea ? " (Linea)" : ""}`;
    $("switchBtn").disabled = isLinea;
  } catch {
    $("network").textContent = "—";
  }
}

async function updateEthBalance() {
  if (!ethersProvider || !user) { $("ethBal").textContent = "—"; return; }
  try {
    const bal = await ethersProvider.getBalance(user);
    $("ethBal").textContent =
      `${Number(formatEther(bal)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH`;
  } catch {
    $("ethBal").textContent = "—";
  }
}

async function ensureLinea() {
  if (!eip1193) throw new Error("No wallet provider");

  const chainIdHex = await eip1193.request({ method: "eth_chainId" });
  const chainId = parseInt(chainIdHex, 16);
  if (chainId === LINEA_CHAIN_ID_DEC) return;

  try {
    await eip1193.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: LINEA_CHAIN_ID_HEX }]
    });
  } catch (e) {
    const msg = String(e?.message || "");
    if (e?.code === 4902 || msg.includes("Unrecognized chain")) {
      await eip1193.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: LINEA_CHAIN_ID_HEX,
          chainName: "Linea",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://rpc.linea.build"],
          blockExplorerUrls: ["https://lineascan.build"]
        }]
      });
      await eip1193.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: LINEA_CHAIN_ID_HEX }]
      });
    } else {
      throw e;
    }
  }
}

function startCountdown() {
  stopCountdown();
  countdownInterval = setInterval(async () => {
    if (!user || !contract) return;

    if (latestCanClaimNow) {
      $("nextClaim").textContent = "Ready now";
      $("claimBtn").disabled = false;
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const secondsLeft = Number(latestNextClaimAt) - nowSec;
    $("nextClaim").textContent = formatCountdown(secondsLeft);

    if (secondsLeft <= 0) {
      try { await refresh(); } catch {}
    }
  }, 1000);
}

async function refresh() {
  if (!user || !contract || !ethersProvider) return;

  await updateNetworkLabel();
  await updateEthBalance();

  // wrong chain => disable claim
  try {
    const net = await ethersProvider.getNetwork();
    if (Number(net.chainId) !== LINEA_CHAIN_ID_DEC) {
      $("canClaim").textContent = "NO (Wrong network)";
      $("nextClaim").textContent = "Switch to Linea";
      $("windowEnds").textContent = "—";
      $("remaining").textContent = "—";
      $("claimBtn").disabled = true;
      return;
    }
  } catch {}

  const [okReason, nextClaimAt, windowEndsAt, firstAt, cap, total] = await Promise.all([
    contract.canClaim(user),
    contract.nextClaimTime(user),
    contract.windowEndTime(user),
    contract.firstClaimAt(user),
    contract.cap(),
    contract.totalSupply()
  ]);

  const canClaimNow = okReason[0];
  const reason = okReason[1];

  latestCanClaimNow = canClaimNow;
  latestNextClaimAt = Number(nextClaimAt);

  const started = (firstAt && Number(firstAt) !== 0);
  const remainingSupply = cap - total;

  $("canClaim").textContent = canClaimNow ? "YES" : `NO (${reason})`;

  if (!started) $("nextClaim").textContent = "Now (first claim)";
  else if (canClaimNow) $("nextClaim").textContent = "Ready now";
  else {
    const nowSec = Math.floor(Date.now() / 1000);
    $("nextClaim").textContent = formatCountdown(Number(nextClaimAt) - nowSec);
  }

  $("windowEnds").textContent = started ? fmtTime(windowEndsAt) : "After first claim";
  $("remaining").textContent =
    `${Number(formatUnits(remainingSupply, decimals)).toLocaleString()} DUST`;

  $("claimBtn").disabled = !canClaimNow;
  startCountdown();
}

// =========================
// AppKit subscriptions (CORRECT)
// =========================
if (appKit) {
  // Provider (EIP-1193)
  appKit.subscribeProviders(async (state) => {
    eip1193 = state?.eip155 || null;

    // if provider disappeared => reset
    if (!eip1193) {
      resetUiDisconnected();
      return;
    }

    try {
      if (user) {
        await rebuildEthers();
        await refresh();
      }
    } catch {}
  });

  // Account
  appKit.subscribeAccount(async (state) => {
    user = state?.address || null;

    if (!user) {
      resetUiDisconnected();
      return;
    }

    $("wallet").textContent = shortAddr(user);
    $("disconnectBtn").style.display = "block";

    try {
      await rebuildEthers();
      await refresh();
    } catch (e) {
      setErr(e?.message || String(e));
    }
  });
}

// =========================
// Buttons
// =========================
resetUiDisconnected();

$("connectBtn").addEventListener("click", () => {
  clearAlerts();
  if (!appKit) {
    setErr("AppKit not initialized. Check VITE_REOWN_PROJECT_ID and restart dev server.");
    return;
  }
  // Open AppKit connect modal
  appKit.open({ view: "Connect", namespace: "eip155" });
});

$("switchBtn").addEventListener("click", async () => {
  clearAlerts();
  try {
    if (!user) throw new Error("Connect a wallet first.");
    await ensureLinea();
    await refresh();
    setMsg("Switched to Linea.");
  } catch (e) {
    setErr(e?.message || String(e));
  }
});

$("claimBtn").addEventListener("click", async () => {
  clearAlerts();
  try {
    if (!user || !contract) throw new Error("Not connected.");
    await ensureLinea();

    $("claimBtn").disabled = true;
    setMsg("Confirm the transaction in your wallet...");

    const tx = await contract.claimDaily();
    setMsg(`Transaction sent: ${tx.hash}\nWaiting for confirmation...`);

    const receipt = await tx.wait();
    setMsg(`Confirmed in block ${receipt.blockNumber}.\nYou received 5 DUST.`);

    await refresh();
  } catch (e) {
    setErr(e?.shortMessage || e?.reason || e?.message || String(e));
    try { await refresh(); } catch {}
  }
});

$("disconnectBtn").addEventListener("click", async () => {
  clearAlerts();
  try {
    // Close session (supported by AppKit)
    await appKit.disconnect?.("eip155");
  } catch {}
  resetUiDisconnected();
  setMsg("Disconnected.");
});