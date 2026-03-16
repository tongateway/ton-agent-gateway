const API_URL = 'https://api.tongateway.ai';
const POLL_INTERVAL = 3000;

let token = null;
let walletAddress = null;
let pollTimer = null;

// --- TON Connect ---

const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
  manifestUrl: window.location.origin + '/tonconnect-manifest.json',
  buttonRootId: 'ton-connect',
});

tonConnectUI.onStatusChange(async (wallet) => {
  if (wallet) {
    walletAddress = wallet.account.address;
    log('Wallet connected: ' + shortAddr(walletAddress));
    await fetchToken();
  } else {
    walletAddress = null;
    token = null;
    stopPolling();
    hide('auth-section');
    hide('pending-section');
    log('Wallet disconnected');
  }
});

// --- Auth ---

async function fetchToken() {
  try {
    const res = await fetch(API_URL + '/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: walletAddress }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Auth failed');

    token = data.token;
    document.getElementById('agent-token').textContent = token;
    document.getElementById('copy-token').disabled = false;
    show('auth-section');
    show('pending-section');
    startPolling();
    log('Token received', 'ok');
  } catch (e) {
    log('Auth error: ' + e.message, 'err');
  }
}

document.getElementById('copy-token').addEventListener('click', () => {
  if (token) {
    navigator.clipboard.writeText(token);
    log('Token copied to clipboard', 'ok');
  }
});

// --- Polling ---

function startPolling() {
  stopPolling();
  poll();
  pollTimer = setInterval(poll, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function poll() {
  if (!token) return;

  try {
    const res = await fetch(API_URL + '/v1/safe/tx/pending', {
      headers: { Authorization: 'Bearer ' + token },
    });

    if (!res.ok) return;

    const data = await res.json();
    renderPending(data.requests);
  } catch {
    // silent
  }
}

// --- Render ---

function renderPending(requests) {
  const list = document.getElementById('pending-list');

  if (!requests.length) {
    list.innerHTML = '<p class="empty">No pending requests</p>';
    return;
  }

  list.innerHTML = requests.map((r) => `
    <div class="pending-card" data-id="${r.id}">
      <div class="row"><span class="label">To</span><span class="value">${shortAddr(r.to)}</span></div>
      <div class="row"><span class="label">Amount</span><span class="value">${formatNano(r.amountNano)} TON</span></div>
      <div class="row"><span class="label">Expires</span><span class="value">${timeLeft(r.expiresAt)}</span></div>
      <div class="actions">
        <button onclick="approve('${r.id}', '${r.to}', '${r.amountNano}', ${r.payloadBoc ? "'" + r.payloadBoc + "'" : 'null'})">Approve</button>
        <button class="reject" onclick="reject('${r.id}')">Reject</button>
      </div>
    </div>
  `).join('');
}

// --- Actions ---

async function approve(id, to, amountNano, payloadBoc) {
  try {
    log('Sending to wallet for approval...');

    const message = {
      address: to,
      amount: amountNano,
    };

    if (payloadBoc) {
      message.payload = payloadBoc;
    }

    const result = await tonConnectUI.sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + 300,
      messages: [message],
    });

    log('Transaction signed by wallet', 'ok');

    await fetch(API_URL + '/v1/safe/tx/' + id + '/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ txHash: result.boc }),
    });

    log('Request confirmed', 'ok');
    poll();
  } catch (e) {
    log('Approve failed: ' + (e.message || 'User rejected'), 'err');
  }
}

async function reject(id) {
  try {
    await fetch(API_URL + '/v1/safe/tx/' + id + '/reject', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    });

    log('Request rejected');
    poll();
  } catch (e) {
    log('Reject failed: ' + e.message, 'err');
  }
}

// --- Helpers ---

function shortAddr(addr) {
  if (!addr) return '—';
  if (addr.length <= 16) return addr;
  return addr.slice(0, 8) + '...' + addr.slice(-6);
}

function formatNano(nano) {
  return (BigInt(nano) / 1000000000n).toString() + '.' +
    (BigInt(nano) % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '') || '0';
}

function timeLeft(expiresAt) {
  const sec = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  const min = Math.floor(sec / 60);
  return min > 0 ? min + 'm ' + (sec % 60) + 's' : sec + 's';
}

function log(msg, cls) {
  const el = document.getElementById('log');
  const entry = document.createElement('div');
  entry.className = 'entry' + (cls ? ' ' + cls : '');
  entry.textContent = new Date().toLocaleTimeString() + ' — ' + msg;
  el.prepend(entry);
}

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
