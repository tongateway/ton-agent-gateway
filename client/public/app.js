const API_URL = 'https://api.tongateway.ai';
const POLL_INTERVAL = 3000;

let clientToken = null;
let clientSessionId = null;
let walletAddress = null;
let pollTimer = null;
let autoApprove = true;
let autoApproveProcessing = new Set(); // track IDs currently being auto-approved

// --- TON Connect ---

const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
  manifestUrl: window.location.origin + '/tonconnect-manifest.json',
  buttonRootId: 'ton-connect',
});

tonConnectUI.onStatusChange(async (wallet) => {
  if (wallet) {
    walletAddress = wallet.account.address;
    log('Wallet connected: ' + shortAddr(walletAddress));
    await initSession();
  } else {
    walletAddress = null;
    clientToken = null;
    clientSessionId = null;
    stopPolling();
    hide('auth-section');
    hide('pending-section');
    log('Wallet disconnected');
  }
});

// --- Auth ---

async function initSession() {
  try {
    const res = await fetch(API_URL + '/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: walletAddress, label: 'dashboard', reuse: true }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Auth failed');

    clientToken = data.token;
    clientSessionId = data.sessionId;
    show('auth-section');
    show('pending-section');
    startPolling();
    await loadSessions();
    log('Connected', 'ok');
  } catch (e) {
    log('Auth error: ' + e.message, 'err');
  }
}

async function createToken() {
  const labelInput = document.getElementById('token-label');
  const label = labelInput.value.trim() || 'agent';
  try {
    const res = await fetch(API_URL + '/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: walletAddress, label }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');

    labelInput.value = '';
    log('Token "' + label + '" created', 'ok');

    showNewToken(data.token, data.label, data.sessionId);
    await loadSessions();
  } catch (e) {
    log('Create token error: ' + e.message, 'err');
  }
}

async function loadSessions() {
  if (!clientToken) return;
  try {
    const res = await fetch(API_URL + '/v1/auth/sessions', {
      headers: { Authorization: 'Bearer ' + clientToken },
    });
    if (!res.ok) return;
    const data = await res.json();
    renderSessions(data.sessions);
  } catch {
    // silent
  }
}

async function revokeToken(sid, label) {
  try {
    const res = await fetch(API_URL + '/v1/auth/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + clientToken,
      },
      body: JSON.stringify({ sessionId: sid }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    log('Token "' + label + '" revoked', 'ok');
    await loadSessions();
  } catch (e) {
    log('Revoke error: ' + e.message, 'err');
  }
}

async function revokeAll() {
  try {
    const res = await fetch(API_URL + '/v1/auth/revoke-all', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + clientToken },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    log('Revoked ' + data.revoked + ' token(s)', 'ok');
    await loadSessions();
  } catch (e) {
    log('Revoke all error: ' + e.message, 'err');
  }
}

document.getElementById('create-token').addEventListener('click', createToken);
document.getElementById('token-label').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createToken();
});

// --- Auto-approve toggle ---

function toggleAutoApprove() {
  autoApprove = document.getElementById('auto-approve-toggle').checked;
  log(autoApprove ? 'Auto-approve ON — requests will be sent to wallet automatically' : 'Auto-approve OFF', autoApprove ? 'ok' : '');
}

// --- Render Tokens ---

function showNewToken(token, label, sid) {
  const existing = document.getElementById('new-token-banner');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'new-token-banner';
  el.className = 'new-token-banner';
  el.innerHTML = `
    <div class="new-token-header">
      <span>New token created: <strong>${esc(label)}</strong></span>
      <button class="dismiss" onclick="this.closest('.new-token-banner').remove()">Dismiss</button>
    </div>
    <p class="new-token-warning">Copy this token now — it won't be shown again.</p>
    <div class="token-box">
      <code>${esc(token)}</code>
      <button onclick="navigator.clipboard.writeText('${esc(token)}');log('Token copied','ok')">Copy</button>
    </div>
  `;
  document.getElementById('token-list').prepend(el);
}

function renderSessions(sessions) {
  const list = document.getElementById('token-list');
  const banner = document.getElementById('new-token-banner');

  const sorted = sessions.sort((a, b) => b.createdAt - a.createdAt);
  const cards = sorted.map((s) => {
    const isMe = s.sid === clientSessionId;
    const age = timeAgo(s.createdAt);
    return `
      <div class="token-card">
        <div class="token-card-row">
          <span class="token-label">${esc(s.label)}${isMe ? ' <span class="badge-self">this session</span>' : ''}</span>
          <span class="token-age">${age}</span>
        </div>
        <div class="token-card-actions">
          ${isMe ? '' : `<button class="revoke" onclick="revokeToken('${s.sid}','${esc(s.label)}')">Revoke</button>`}
        </div>
      </div>
    `;
  }).join('');

  const bannerHtml = banner ? banner.outerHTML : '';
  list.innerHTML = bannerHtml + cards;

  if (!sessions.length && !banner) {
    list.innerHTML = '<p class="empty">No tokens yet</p>';
  }

  const othersCount = sessions.filter(s => s.sid !== clientSessionId).length;
  const revokeAllRow = document.getElementById('revoke-all-row');
  if (revokeAllRow) {
    if (othersCount > 0) revokeAllRow.classList.remove('hidden');
    else revokeAllRow.classList.add('hidden');
  }
}

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
  if (!clientToken) return;
  try {
    const res = await fetch(API_URL + '/v1/safe/tx/pending', {
      headers: { Authorization: 'Bearer ' + clientToken },
    });
    if (!res.ok) return;
    const data = await res.json();
    renderPending(data.requests);

    // Auto-approve: send new requests to wallet automatically
    if (autoApprove && data.requests.length > 0) {
      for (const r of data.requests) {
        if (!autoApproveProcessing.has(r.id)) {
          autoApproveProcessing.add(r.id);
          log('Auto-approving: ' + formatNano(r.amountNano) + ' TON to ' + shortAddr(r.to));
          approve(r.id, r.to, r.amountNano, r.payloadBoc || null);
        }
      }
    }
  } catch {
    // silent
  }
}

// --- Render Pending ---

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
    log('Sending to wallet for signing...');
    const message = { address: to, amount: amountNano };
    if (payloadBoc) message.payload = payloadBoc;

    const result = await tonConnectUI.sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + 300,
      messages: [message],
    });

    log('Transaction signed by wallet', 'ok');

    await fetch(API_URL + '/v1/safe/tx/' + id + '/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + clientToken,
      },
      body: JSON.stringify({ txHash: result.boc }),
    });

    log('Request confirmed', 'ok');
    autoApproveProcessing.delete(id);
    poll();
  } catch (e) {
    log('Approve failed: ' + (e.message || 'User rejected'), 'err');
    autoApproveProcessing.delete(id);
  }
}

async function reject(id) {
  try {
    await fetch(API_URL + '/v1/safe/tx/' + id + '/reject', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + clientToken },
    });
    log('Request rejected');
    autoApproveProcessing.delete(id);
    poll();
  } catch (e) {
    log('Reject failed: ' + e.message, 'err');
  }
}

// --- Helpers ---

function shortAddr(addr) {
  if (!addr) return '\u2014';
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

function timeAgo(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  return Math.floor(hr / 24) + 'd ago';
}

function esc(s) {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

function log(msg, cls) {
  const el = document.getElementById('log');
  const entry = document.createElement('div');
  entry.className = 'entry' + (cls ? ' ' + cls : '');
  entry.textContent = new Date().toLocaleTimeString() + ' \u2014 ' + msg;
  el.prepend(entry);
}

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
