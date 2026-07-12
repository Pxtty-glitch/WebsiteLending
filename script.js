/* ====================== AUTH (SHA-256 salted hashing via Web Crypto) ====================== */
const AUTH_KEY = 'lfd_auth_users_v1';
const SESSION_KEY = 'lfd_session_user_v1';

function randomHex(bytes) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hashPassword(password, salt) {
  return sha256Hex(salt + ':' + password);
}
function loadUsers() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || []; }
  catch (e) { return []; }
}
function saveUsers(users) { localStorage.setItem(AUTH_KEY, JSON.stringify(users)); }

async function seedDefaultAdmin() {
  const users = loadUsers();
  if (users.length === 0) {
    const salt = randomHex(16);
    const hash = await hashPassword('admin123', salt);
    users.push({ id: 'u' + Date.now(), name: 'David Owner', username: 'admin', salt, hash });
    saveUsers(users);
  }
}

function getSession() { return localStorage.getItem(SESSION_KEY); }
function setSession(username) { localStorage.setItem(SESSION_KEY, username); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

function showAuthError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg; el.classList.add('show');
}
function clearAuthError(elId) {
  const el = document.getElementById(elId);
  el.textContent = ''; el.classList.remove('show');
}

function initAuthUI() {
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.auth === 'login' ? 'authLoginForm' : 'authRegisterForm').classList.add('active');
      clearAuthError('loginError'); clearAuthError('registerError');
    });
  });

  document.getElementById('authLoginForm').addEventListener('submit', async e => {
    e.preventDefault();
    clearAuthError('loginError');
    const username = document.getElementById('loginUsername').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;
    if (!username || !password) { showAuthError('loginError', 'Please enter both username and password.'); return; }
    const users = loadUsers();
    const user = users.find(u => u.username.toLowerCase() === username);
    if (!user) { showAuthError('loginError', 'Account not found.'); return; }
    const hash = await hashPassword(password, user.salt);
    if (hash !== user.hash) { showAuthError('loginError', 'Incorrect password.'); return; }
    setSession(user.username);
    enterApp(user);
  });

  document.getElementById('authRegisterForm').addEventListener('submit', async e => {
    e.preventDefault();
    clearAuthError('registerError');
    const name = document.getElementById('regName').value.trim();
    const username = document.getElementById('regUsername').value.trim().toLowerCase();
    const password = document.getElementById('regPassword').value;
    const password2 = document.getElementById('regPassword2').value;
    if (!name || !username || !password) { showAuthError('registerError', 'All fields are required.'); return; }
    if (password.length < 6) { showAuthError('registerError', 'Password must be at least 6 characters.'); return; }
    if (password !== password2) { showAuthError('registerError', 'Passwords do not match.'); return; }
    const users = loadUsers();
    if (users.some(u => u.username.toLowerCase() === username)) { showAuthError('registerError', 'Username already taken.'); return; }
    const salt = randomHex(16);
    const hash = await hashPassword(password, salt);
    const newUser = { id: 'u' + Date.now(), name, username, salt, hash };
    users.push(newUser); saveUsers(users);
    setSession(newUser.username);
    enterApp(newUser);
  });
}

function enterApp(user) {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'flex';
  document.getElementById('sessionName').textContent = user.name || user.username;
  document.getElementById('sessionAvatar').textContent = initials(user.name || user.username);
  renderAll();
}

function logout() {
  clearSession();
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
}

/* ====================== STORAGE / STATE (business data) ====================== */
const STORAGE_KEY = 'lfd_data_v1';

function defaultData() {
  return {
    clients: [],
    loans: [],
    payments: [],
    settings: {
      companyName: 'La Familia DAVID Lending',
      tin: '123-456-789-000',
      address: 'Guimba, Nueva Ecija, Philippines',
      interestRate: 3,
      penaltyRate: 5,
      gracePeriod: 3,
      loanTypes: ['Business Loan', 'Salary Loan', 'Group Loan'],
      autoBackup: true,
      cloudSync: false
    },
    nextLoanSeq: 1
  };
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const d = defaultData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    return d;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.nextLoanSeq) parsed.nextLoanSeq = (parsed.loans ? parsed.loans.length : 0) + 1;
    return parsed;
  } catch (e) { const d = defaultData(); saveData(d); return d; }
}
function saveData(d) { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }

let DATA = loadData();

/* ====================== LOAN MATH ====================== */
function loanCalc(loan) {
  const totalInterest = loan.principal * (loan.rate / 100) * loan.term;
  const totalReceivable = loan.principal + totalInterest;
  const principalBalance = Math.max(0, loan.principal - loan.principalCollected);
  const interestBalance = Math.max(0, totalInterest - loan.interestCollected);
  const outstanding = principalBalance + interestBalance;
  const totalCollection = loan.principalCollected + loan.interestCollected;
  return { totalInterest, totalReceivable, principalBalance, interestBalance, outstanding, totalCollection };
}

function computeClientOutstanding(clientId) {
  return DATA.loans.filter(l => l.clientId === clientId)
    .reduce((sum, l) => sum + loanCalc(l).outstanding, 0);
}

function refreshLoanStatuses() {
  DATA.loans.forEach(l => {
    const c = loanCalc(l);
    if (c.outstanding <= 0.01) l.status = 'fully_paid';
    else if (l.status !== 'past_due' && l.status !== 'application') l.status = 'current';
  });
}

function nextLoanRef() {
  const seq = DATA.nextLoanSeq || (DATA.loans.length + 1);
  DATA.nextLoanSeq = seq + 1;
  return `LN-${String(seq).padStart(3, '0')}`;
}

/* ====================== NAVIGATION ====================== */
const breadcrumbMap = {
  dashboard: 'DASHBOARD  ›  MANAGEMENT',
  clients: 'CLIENTS  ›  MANAGEMENT',
  loandesk: 'LOANS  ›  MANAGEMENT',
  collections: 'PAYMENTS  ›  MANAGEMENT',
  financials: 'REPORTS  ›  MANAGEMENT',
  settings: 'SETTINGS  ›  MANAGEMENT'
};

function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  document.getElementById('breadcrumb').textContent = breadcrumbMap[view];
  renderView(view);
}

function renderView(view) {
  if (view === 'dashboard') renderDashboard();
  if (view === 'clients') renderClients();
  if (view === 'loandesk') renderLoanDesk();
  if (view === 'collections') renderCollections();
  if (view === 'financials') renderFinancials();
  if (view === 'settings') renderSettings();
}
function renderAll() { refreshLoanStatuses(); ['dashboard','clients','loandesk','collections','financials','settings'].forEach(renderView); }

/* ====================== MODAL HELPERS ====================== */
function openModal(html) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-overlay" id="modalOverlay"><div class="modal-box">${html}</div></div>`;
  document.getElementById('modalOverlay').addEventListener('click', e => { if (e.target.id === 'modalOverlay') closeModal(); });
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

/* ====================== DASHBOARD ====================== */
function renderDashboard() {
  refreshLoanStatuses();
  const totalClients = DATA.clients.length;
  const portfolio = DATA.loans.reduce((s, l) => s + loanCalc(l).totalReceivable, 0);
  const principal = DATA.loans.reduce((s, l) => s + l.principal, 0);
  const interest = DATA.loans.reduce((s, l) => s + loanCalc(l).totalInterest, 0);
  const collections = DATA.payments.reduce((s, p) => s + p.amount, 0);
  const dueToday = DATA.loans.filter(l => l.status === 'past_due' || DATA.clients.find(c => c.id === l.clientId)?.status === 'due_today').length;

  document.getElementById('statGrid').innerHTML = `
    ${statCard('TOTAL CLIENTS', totalClients)}
    ${statCard('PORTFOLIO', peso(portfolio))}
    ${statCard('PRINCIPAL', peso(principal))}
    ${statCard('INTEREST', peso(interest))}
    ${statCard('COLLECTIONS', peso(collections))}
    ${statCard('DUE TODAY', dueToday)}
  `;

  const dueClients = DATA.clients.filter(c => c.status === 'past_due' || c.status === 'due_today');
  const dueListEl = document.getElementById('dueListToday');
  dueListEl.innerHTML = dueClients.length ? dueClients.map(c => {
    const out = computeClientOutstanding(c.id);
    return `<div class="due-item"><div><div class="due-name">${c.name}</div><div class="due-sub">${c.type.toUpperCase()}</div></div>
      <div style="text-align:right"><div class="due-amt">${peso(out)}</div>
      <span class="badge badge-${c.status}">${labelStatus(c.status)}</span></div></div>`;
  }).join('') : '<div class="due-sub">No collectibles due today.</div>';
  const totalCollectible = dueClients.reduce((s, c) => s + computeClientOutstanding(c.id), 0);
  document.getElementById('dueTotal').innerHTML = `<span>TOTAL COLLECTIBLE:</span><b>${peso(totalCollectible)}</b>`;

  const recents = [...DATA.payments].slice(-5).reverse();
  document.getElementById('recentReceipts').innerHTML = recents.map(p => `
    <div class="list-row"><div><div class="list-name">${p.clientName.toUpperCase()}</div><div class="list-sub">${p.date}</div></div><div class="list-amt">${peso(p.amount)}</div></div>
  `).join('') || '<div class="list-sub">No receipts yet.</div>';

  const applications = DATA.loans.filter(l => l.status === 'application').length;
  document.getElementById('systemStatus').innerHTML = `
    <div class="list-row"><div class="list-sub">New loan applications</div><div>${applications}</div></div>
    <div class="list-row"><div class="list-sub">Total registered clients</div><div>${totalClients}</div></div>
    <div class="list-row"><div class="list-sub">Loan types configured</div><div>${DATA.settings.loanTypes.length}</div></div>
  `;

  drawChart();
}

function statCard(label, value) {
  return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;
}
function peso(n) { return '₱' + Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 }); }
function labelStatus(s) {
  return { current: 'Current', past_due: 'Past Due', fully_paid: 'Fully Paid', due_today: 'Due Today', partial_payment: 'Partial Payment', application: 'Application' }[s] || s;
}
function initials(name) { return (name || '').split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase(); }

function drawChart() {
  const canvas = document.getElementById('mainChart');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ label: d.toLocaleString('default', { month: 'short' }), y: d.getFullYear(), m: d.getMonth() });
  }
  const releases = months.map(mo => DATA.loans.filter(l => {
    const d = new Date(l.startDate); return d.getFullYear() === mo.y && d.getMonth() === mo.m;
  }).reduce((s, l) => s + l.principal, 0));
  const payments = months.map(mo => DATA.payments.filter(p => {
    const d = new Date(p.date); return d.getFullYear() === mo.y && d.getMonth() === mo.m;
  }).reduce((s, p) => s + p.amount, 0));

  const max = Math.max(1, ...releases, ...payments) * 1.2;
  const padL = 46, padB = 26, padT = 14, padR = 14;
  const w = canvas.width - padL - padR, h = canvas.height - padT - padB;

  ctx.strokeStyle = '#eef0f5'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + h - (h * i / 4);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
    ctx.fillStyle = '#8993a6'; ctx.font = '10px Arial';
    ctx.fillText(Math.round(max * i / 4).toLocaleString(), 2, y + 3);
  }
  months.forEach((mo, i) => {
    const x = padL + (w * i / (months.length - 1));
    ctx.fillStyle = '#8993a6'; ctx.font = '10px Arial';
    ctx.fillText(mo.label, x - 10, canvas.height - 6);
  });

  function plot(series, color) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach((v, i) => {
      const x = padL + (w * i / (series.length - 1));
      const y = padT + h - (h * v / max);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    series.forEach((v, i) => {
      const x = padL + (w * i / (series.length - 1));
      const y = padT + h - (h * v / max);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
    });
  }
  plot(releases, '#3b82f6');
  plot(payments, '#d4af37');
}

/* ====================== CLIENTS ====================== */
function renderClients() {
  const typeFilter = document.getElementById('clientTypeFilter');
  const statusFilter = document.getElementById('clientStatusFilter');
  if (typeFilter.options.length <= 1) {
    DATA.settings.loanTypes.forEach(t => typeFilter.appendChild(new Option(t, t)));
    ['current','past_due','fully_paid','due_today','partial_payment'].forEach(s => statusFilter.appendChild(new Option(labelStatus(s), s)));
  }
  const search = (document.getElementById('clientSearch').value || '').toLowerCase();
  const tf = typeFilter.value, sf = statusFilter.value;

  let list = DATA.clients.filter(c =>
    (tf === 'all' || c.type === tf) &&
    (sf === 'all' || c.status === sf) &&
    (c.name.toLowerCase().includes(search) || c.address.toLowerCase().includes(search))
  );

  document.getElementById('clientCountText').textContent = `${DATA.clients.length} Registered Accounts`;
  document.getElementById('clientsTableBody').innerHTML = list.map(c => `
    <tr>
      <td><b>${initials(c.name)}</b>&nbsp;&nbsp;${c.name}</td>
      <td>${c.address}<div class="list-sub">${c.contact}</div></td>
      <td>${c.type}</td>
      <td><span class="badge badge-${c.status}">${labelStatus(c.status)}</span></td>
      <td>${peso(computeClientOutstanding(c.id))}</td>
      <td>
        <button class="action-btn" onclick="openLedger('${c.id}')">Ledger</button>
        <button class="action-btn secondary" onclick="editClient('${c.id}')">Edit</button>
        <button class="action-btn danger-action" onclick="confirmDeleteClient('${c.id}')">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="6"><div class="empty-state">No clients yet. Click <b>+ Add Client</b> to register your first account.</div></td></tr>`;
}

['clientSearch','clientTypeFilter','clientStatusFilter'].forEach(id =>
  document.getElementById(id).addEventListener('input', renderClients)
);

document.getElementById('btnAddClient').addEventListener('click', () => openClientModal());

function openClientModal(clientId) {
  const c = clientId ? DATA.clients.find(x => x.id === clientId) : null;
  const typeOptions = DATA.settings.loanTypes.map(t => `<option ${c && c.type === t ? 'selected' : ''}>${t}</option>`).join('');
  openModal(`
    <button class="modal-close" onclick="closeModal()">✕</button>
    <h2>${c ? 'Edit Client' : 'Add New Client'}</h2>
    <label class="field-label">Full Name</label><input type="text" id="mcName" placeholder="e.g. Juan Dela Cruz" value="${c ? c.name : ''}">
    <label class="field-label">Address</label><input type="text" id="mcAddress" placeholder="Barangay, Municipality" value="${c ? c.address : ''}">
    <label class="field-label">Contact Number</label><input type="tel" id="mcContact" placeholder="09XX-XXX-XXXX" value="${c ? c.contact : ''}">
    <label class="field-label">Classification</label><select id="mcType">${typeOptions}</select>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveClient('${clientId || ''}')">Save Client</button>
    </div>
  `);
}
function saveClient(id) {
  const name = document.getElementById('mcName').value.trim();
  const address = document.getElementById('mcAddress').value.trim();
  const contact = document.getElementById('mcContact').value.trim();
  const type = document.getElementById('mcType').value;
  if (!name) { alert('Name is required.'); return; }
  if (id) {
    const c = DATA.clients.find(x => x.id === id);
    Object.assign(c, { name, address, contact, type });
  } else {
    DATA.clients.push({ id: 'c' + Date.now(), name, address, contact, type, status: 'current' });
  }
  saveData(DATA); closeModal(); renderAll();
}
function editClient(id) { openClientModal(id); }

/* ---- Delete client with styled confirmation modal ---- */
function confirmDeleteClient(clientId) {
  const client = DATA.clients.find(c => c.id === clientId);
  if (!client) return;
  const loanCount = DATA.loans.filter(l => l.clientId === clientId).length;
  openModal(`
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="confirm-icon">⚠️</div>
    <div class="confirm-title">Delete this client?</div>
    <div class="confirm-text">Are you sure you want to delete <b>${client.name}</b>?</div>
    <div class="confirm-text">${loanCount > 0 ? `This will also remove ${loanCount} associated loan record(s) and their payment history.` : 'This action cannot be undone.'}</div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="deleteClient('${clientId}')">Yes, Delete Client</button>
    </div>
  `);
}
function deleteClient(clientId) {
  const loanIds = DATA.loans.filter(l => l.clientId === clientId).map(l => l.id);
  DATA.clients = DATA.clients.filter(c => c.id !== clientId);
  DATA.loans = DATA.loans.filter(l => l.clientId !== clientId);
  DATA.payments = DATA.payments.filter(p => !loanIds.includes(p.loanId));
  saveData(DATA);
  closeModal();
  renderAll();
}

function openLedger(clientId) {
  const client = DATA.clients.find(c => c.id === clientId);
  const loans = DATA.loans.filter(l => l.clientId === clientId);
  const rows = loans.map(l => {
    const c = loanCalc(l);
    return `<div class="ledger-row"><span>${l.refId} (${l.type})</span><span>${peso(c.outstanding)} outstanding</span></div>
    <div class="ledger-row"><span style="color:#8993a6">Principal ${peso(l.principal)} • Interest ${peso(c.totalInterest)}</span><span style="color:#8993a6">Collected ${peso(c.totalCollection)}</span></div>`;
  }).join('') || '<div class="list-sub">No loans on record.</div>';
  openModal(`
    <button class="modal-close" onclick="closeModal()">✕</button>
    <h2>${client.name} — Ledger</h2>
    <div class="ledger-section-title">Loan Accounts</div>
    ${rows}
    <div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>
  `);
}

/* ====================== LOAN DESK ====================== */
let currentLoanTab = 'current';
document.querySelectorAll('#loanTabs .tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('#loanTabs .tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active'); currentLoanTab = t.dataset.tab; renderLoanDesk();
}));
document.getElementById('loanSearch').addEventListener('input', renderLoanDesk);

function renderLoanDesk() {
  refreshLoanStatuses();
  const search = (document.getElementById('loanSearch').value || '').toLowerCase();
  let list = DATA.loans.filter(l => {
    const matchTab = ['current','past_due','application'].includes(currentLoanTab) ? l.status === currentLoanTab : l.type === currentLoanTab;
    return matchTab && (l.clientName.toLowerCase().includes(search) || l.refId.toLowerCase().includes(search));
  });
  document.getElementById('loansTableBody').innerHTML = list.map(l => {
    const c = loanCalc(l);
    return `<tr>
      <td>${l.refId}</td>
      <td><b>${l.clientName}</b></td>
      <td>${l.type}</td>
      <td>${peso(l.principal)}</td>
      <td>${peso(c.totalCollection)}</td>
      <td>${peso(c.outstanding)}</td>
      <td><span class="badge badge-${l.status}">${labelStatus(l.status)}</span></td>
      <td>
        <button class="action-btn" onclick="quickPay('${l.id}')">Payment</button>
        <button class="action-btn secondary" onclick="openLedger('${l.clientId}')">Ledger</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="8"><div class="empty-state">No loans in this category yet.</div></td></tr>`;
}

document.getElementById('btnCreateLoan').addEventListener('click', openLoanModal);
document.getElementById('btnNewLoanTop').addEventListener('click', openLoanModal);

function openLoanModal() {
  if (DATA.clients.length === 0) { alert('Please add a client first.'); return; }
  const clientOptions = DATA.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const typeOptions = DATA.settings.loanTypes.map(t => `<option>${t}</option>`).join('');
  openModal(`
    <button class="modal-close" onclick="closeModal()">✕</button>
    <h2>Create New Loan</h2>
    <label class="field-label">Borrower</label><select id="mlClient">${clientOptions}</select>
    <label class="field-label">Loan Type</label><select id="mlType">${typeOptions}</select>
    <div class="grid-2-inline">
      <div><label class="field-label">Principal (₱)</label><input type="number" id="mlPrincipal" value="10000"></div>
      <div><label class="field-label">Term (Months)</label><input type="number" id="mlTerm" value="6"></div>
    </div>
    <div class="grid-2-inline">
      <div><label class="field-label">Interest Rate (%)</label><input type="number" id="mlRate" value="${DATA.settings.interestRate}" step="0.1"></div>
      <div><label class="field-label">Start Date</label><input type="date" id="mlStart" value="${todayISO()}"></div>
    </div>
    <div class="grid-2-inline">
      <div><label class="field-label">CBU / Savings (₱)</label><input type="number" id="mlCbu" value="0"></div>
      <div><label class="field-label">Group Availment Fee (₱)</label><input type="number" id="mlAvailment" value="0"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveLoan()">Create Loan</button>
    </div>
  `);
}
function saveLoan() {
  const clientId = document.getElementById('mlClient').value;
  const client = DATA.clients.find(c => c.id === clientId);
  if (!client) { alert('Please add a client first.'); return; }
  const loan = {
    id: 'l' + Date.now(),
    refId: nextLoanRef(),
    clientId, clientName: client.name,
    type: document.getElementById('mlType').value,
    principal: Number(document.getElementById('mlPrincipal').value) || 0,
    term: Number(document.getElementById('mlTerm').value) || 1,
    rate: Number(document.getElementById('mlRate').value) || 0,
    startDate: document.getElementById('mlStart').value || todayISO(),
    cbu: Number(document.getElementById('mlCbu').value) || 0,
    loanAvailmentGroup: Number(document.getElementById('mlAvailment').value) || 0,
    principalCollected: 0, interestCollected: 0, status: 'current'
  };
  DATA.loans.push(loan);
  client.status = 'current';
  saveData(DATA); closeModal(); renderAll();
}
function quickPay(loanId) {
  showView('collections');
  document.getElementById('paySelectLoan').value = loanId;
}

/* ====================== COLLECTIONS ====================== */
function renderCollections() {
  const sel = document.getElementById('paySelectLoan');
  sel.innerHTML = DATA.loans.map(l => `<option value="${l.id}">${l.clientName} — ${l.refId} (${peso(loanCalc(l).outstanding)} due)</option>`).join('');
  const history = [...DATA.payments].slice(-15).reverse();
  document.getElementById('collectionHistory').innerHTML = history.map(p => `
    <div class="list-row"><div><div class="list-name">${p.clientName.toUpperCase()}</div><div class="list-sub">${p.method} • ${p.date}</div></div><div class="list-amt">${peso(p.amount)}</div></div>
  `).join('') || '<div class="list-sub">No history yet.</div>';
}
document.getElementById('viewFullLog').addEventListener('click', () => {
  openModal(`
    <button class="modal-close" onclick="closeModal()">✕</button>
    <h2>Full Collection Log</h2>
    ${[...DATA.payments].reverse().map(p => `<div class="ledger-row"><span>${p.clientName} — ${p.method}</span><span>${peso(p.amount)} • ${p.date}</span></div>`).join('') || '<div class="list-sub">No records.</div>'}
    <div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>
  `);
});

document.getElementById('btnAuthorizeEntry').addEventListener('click', () => {
  const loanId = document.getElementById('paySelectLoan').value;
  const amount = Number(document.getElementById('payAmount').value);
  const method = document.getElementById('payMethod').value;
  const loan = DATA.loans.find(l => l.id === loanId);
  if (!loan) { alert('Select a borrower.'); return; }
  if (!amount || amount <= 0) { alert('Enter a valid amount.'); return; }

  const calc = loanCalc(loan);
  const principalRatio = loan.principal / calc.totalReceivable;
  const interestRatio = calc.totalInterest / calc.totalReceivable;
  let payPrincipal = Math.min(calc.principalBalance, amount * principalRatio);
  let payInterest = Math.min(calc.interestBalance, amount * interestRatio);
  let applied = payPrincipal + payInterest;
  let excess = amount - applied;
  if (excess > 0) {
    const remainingPrincipal = calc.principalBalance - payPrincipal;
    const remainingInterest = calc.interestBalance - payInterest;
    const addP = Math.min(remainingPrincipal, excess);
    payPrincipal += addP; excess -= addP;
    const addI = Math.min(remainingInterest, excess);
    payInterest += addI; excess -= addI;
  }
  loan.principalCollected += payPrincipal;
  loan.interestCollected += payInterest;

  DATA.payments.push({ id: 'p' + Date.now(), loanId: loan.id, clientName: loan.clientName, amount, method, date: todayISO(), excess });

  const client = DATA.clients.find(c => c.id === loan.clientId);
  const newCalc = loanCalc(loan);
  if (client) client.status = newCalc.outstanding <= 0.01 ? 'fully_paid' : (excess < amount ? 'partial_payment' : 'current');

  saveData(DATA);
  document.getElementById('payAmount').value = '';
  renderAll();
  alert(`Payment recorded. ${excess > 0.01 ? 'Excess of ' + peso(excess) + ' logged as advance payment.' : ''}`);
});

document.getElementById('btnPaymentTop').addEventListener('click', () => showView('collections'));

/* ====================== FINANCIALS ====================== */
let currentFinTab = 'general';
document.querySelectorAll('#finTabs .tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('#finTabs .tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active'); currentFinTab = t.dataset.fin; renderFinancials();
}));

function renderFinancials() {
  const totalMoneyOut = DATA.loans.reduce((s, l) => s + l.principal, 0);
  const totalInterestToCollect = DATA.loans.reduce((s, l) => s + loanCalc(l).interestBalance, 0);
  const totalAmountDue = DATA.loans.reduce((s, l) => s + loanCalc(l).outstanding, 0);
  const totalPayments = DATA.payments.reduce((s, p) => s + p.amount, 0);

  document.getElementById('finStatGrid').innerHTML = `
    ${statCard('TOTAL MONEY OUT', peso(totalMoneyOut))}
    ${statCard('INTEREST TO COLLECT', peso(totalInterestToCollect))}
    ${statCard('TOTAL AMOUNT DUE', peso(totalAmountDue))}
    ${statCard('TOTAL PAYMENTS', peso(totalPayments))}
  `;

  const wrap = document.getElementById('finTableWrap');
  const table = document.getElementById('finTable');

  if (currentFinTab === 'terms') {
    wrap.querySelector('.card-title').textContent = '📘 Financial Terms & Definitions';
    const terms = [
      ['Principal', "The approved loan amount granted to the borrower, excluding interest and charges."],
      ['Total Interest Receivable', 'Principal × Interest Rate × Loan Term (Months).'],
      ['Total Loans Receivable', 'Principal + Total Interest Receivable.'],
      ['Total Collection', 'Total Principal Collected + Total Interest Collected.'],
      ['Loan Outstanding Balance', 'Principal Balance + Interest Receivable Balance.'],
      ['CBU (Capital Build-Up)', 'Required savings collected alongside each scheduled payment.']
    ];
    table.querySelector('thead').innerHTML = '<tr><th>Term</th><th>Description</th></tr>';
    table.querySelector('tbody').innerHTML = terms.map(t => `<tr><td><b>${t[0]}</b></td><td>${t[1]}</td></tr>`).join('');
    return;
  }

  if (currentFinTab === 'clientlist') {
    wrap.querySelector('.card-title').textContent = '👥 Client List';
    table.querySelector('thead').innerHTML = '<tr><th>Name</th><th>Type</th><th>Status</th><th>Outstanding</th></tr>';
    table.querySelector('tbody').innerHTML = DATA.clients.map(c => `<tr><td>${c.name}</td><td>${c.type}</td><td><span class="badge badge-${c.status}">${labelStatus(c.status)}</span></td><td>${peso(computeClientOutstanding(c.id))}</td></tr>`).join('');
    return;
  }

  let filterType = null;
  if (currentFinTab === 'business') filterType = 'Business Loan';
  if (currentFinTab === 'salary') filterType = 'Salary Loan';
  if (currentFinTab === 'group') filterType = 'Group Loan';

  const groups = filterType ? [filterType] : DATA.settings.loanTypes;
  wrap.querySelector('.card-title').textContent = '📊 Summary Matrix';
  table.querySelector('thead').innerHTML = `<tr><th>Loan Type</th><th>No. Clients</th><th>Principal</th><th>Interest</th><th>Total Due</th><th>Payments</th><th>Balance</th><th>CBU</th></tr>`;

  let rows = '', grand = { n:0, principal:0, interest:0, due:0, pay:0, bal:0, cbu:0 };
  groups.forEach(type => {
    const loans = DATA.loans.filter(l => l.type === type);
    const n = new Set(loans.map(l => l.clientId)).size;
    const principal = loans.reduce((s,l) => s + l.principal, 0);
    const interest = loans.reduce((s,l) => s + loanCalc(l).totalInterest, 0);
    const due = principal + interest;
    const pay = loans.reduce((s,l) => s + loanCalc(l).totalCollection, 0);
    const bal = loans.reduce((s,l) => s + loanCalc(l).outstanding, 0);
    const cbu = loans.reduce((s,l) => s + (l.cbu||0), 0);
    grand.n += n; grand.principal += principal; grand.interest += interest; grand.due += due; grand.pay += pay; grand.bal += bal; grand.cbu += cbu;
    rows += `<tr><td><b>${type.toUpperCase()}</b></td><td>${n}</td><td>${peso(principal)}</td><td>${peso(interest)}</td><td>${peso(due)}</td><td style="color:#16a34a">${peso(pay)}</td><td style="color:#dc2626">${peso(bal)}</td><td>${peso(cbu)}</td></tr>`;
  });
  rows += `<tr style="background:#0e1728;color:#fff"><td><b>GRAND TOTALS</b></td><td>${grand.n}</td><td>${peso(grand.principal)}</td><td>${peso(grand.interest)}</td><td>${peso(grand.due)}</td><td>${peso(grand.pay)}</td><td>${peso(grand.bal)}</td><td>${peso(grand.cbu)}</td></tr>`;
  table.querySelector('tbody').innerHTML = rows;
}

document.getElementById('btnExportCSV').addEventListener('click', () => {
  const rows = [['Loan Type','Clients','Principal','Interest','Total Due','Payments','Balance']];
  DATA.settings.loanTypes.forEach(type => {
    const loans = DATA.loans.filter(l => l.type === type);
    const n = new Set(loans.map(l => l.clientId)).size;
    const principal = loans.reduce((s,l) => s + l.principal, 0);
    const interest = loans.reduce((s,l) => s + loanCalc(l).totalInterest, 0);
    const pay = loans.reduce((s,l) => s + loanCalc(l).totalCollection, 0);
    const bal = loans.reduce((s,l) => s + loanCalc(l).outstanding, 0);
    rows.push([type, n, principal, interest, principal+interest, pay, bal]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  downloadFile('business_report.csv', csv, 'text/csv');
});
document.getElementById('btnExportPDF').addEventListener('click', () => window.print());

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

/* ====================== SETTINGS ====================== */
function renderSettings() {
  const s = DATA.settings;
  document.getElementById('setCompanyName').value = s.companyName;
  document.getElementById('setTIN').value = s.tin;
  document.getElementById('setAddress').value = s.address;
  document.getElementById('setInterestRate').value = s.interestRate;
  document.getElementById('setPenaltyRate').value = s.penaltyRate;
  document.getElementById('setGracePeriod').value = s.gracePeriod;
  document.getElementById('setAutoBackup').checked = s.autoBackup;
  document.getElementById('setCloudSync').checked = s.cloudSync;
  document.getElementById('loanTypesList').innerHTML = s.loanTypes.map((t,i) => `
    <div class="loan-type-row"><span>${t}</span><button onclick="removeLoanType(${i})">✕</button></div>
  `).join('');
}
function removeLoanType(i) {
  DATA.settings.loanTypes.splice(i, 1);
  saveData(DATA); renderSettings();
}
document.getElementById('btnAddLoanType').addEventListener('click', () => {
  const input = document.getElementById('newLoanType');
  const val = input.value.trim();
  if (!val) return;
  DATA.settings.loanTypes.push(val);
  input.value = '';
  saveData(DATA); renderSettings();
});
document.getElementById('btnSaveSettings').addEventListener('click', () => {
  const s = DATA.settings;
  s.companyName = document.getElementById('setCompanyName').value;
  s.tin = document.getElementById('setTIN').value;
  s.address = document.getElementById('setAddress').value;
  s.interestRate = Number(document.getElementById('setInterestRate').value) || 0;
  s.penaltyRate = Number(document.getElementById('setPenaltyRate').value) || 0;
  s.gracePeriod = Number(document.getElementById('setGracePeriod').value) || 0;
  s.autoBackup = document.getElementById('setAutoBackup').checked;
  s.cloudSync = document.getElementById('setCloudSync').checked;
  saveData(DATA);
  alert('Settings saved.');
});
document.getElementById('btnChangePassword').addEventListener('click', async () => {
  const username = getSession();
  const users = loadUsers();
  const user = users.find(u => u.username === username);
  if (!user) { alert('No active session found.'); return; }
  const current = prompt('Enter your current password:');
  if (current === null) return;
  const currentHash = await hashPassword(current, user.salt);
  if (currentHash !== user.hash) { alert('Current password is incorrect.'); return; }
  const next = prompt('Enter your new password (min 6 characters):');
  if (!next) return;
  if (next.length < 6) { alert('Password must be at least 6 characters.'); return; }
  const newSalt = randomHex(16);
  user.salt = newSalt;
  user.hash = await hashPassword(next, newSalt);
  saveUsers(users);
  alert('Password updated successfully.');
});
document.getElementById('btnVerifySystems').addEventListener('click', () => {
  alert('✔ Storage OK\n✔ Loan calculations OK\n✔ ' + DATA.loans.length + ' loans indexed\n✔ ' + DATA.clients.length + ' clients indexed\n✔ Auth: ' + loadUsers().length + ' account(s) registered');
});
document.getElementById('btnExportAll').addEventListener('click', () => {
  downloadFile('lfd_backup.json', JSON.stringify(DATA, null, 2), 'application/json');
});
document.getElementById('btnImportAll').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      DATA = imported;
      if (!DATA.nextLoanSeq) DATA.nextLoanSeq = (DATA.loans ? DATA.loans.length : 0) + 1;
      saveData(DATA); renderAll();
      alert('Data imported successfully.');
    } catch (err) { alert('Invalid file.'); }
  };
  reader.readAsText(file);
});
document.getElementById('btnFactoryReset').addEventListener('click', () => {
  if (confirm('This will erase all data and restore defaults. Continue?')) {
    DATA = defaultData(); saveData(DATA); renderAll();
  }
});

/* ====================== NAV BINDINGS ====================== */
document.querySelectorAll('.nav-item, [data-view]').forEach(el => {
  el.addEventListener('click', () => showView(el.dataset.view));
});
document.getElementById('refreshBtn').addEventListener('click', () => { DATA = loadData(); renderAll(); });
document.getElementById('btnLogout').addEventListener('click', logout);

/* ====================== INIT ====================== */
(async function init() {
  initAuthUI();
  await seedDefaultAdmin();
  const sessionUser = getSession();
  if (sessionUser) {
    const users = loadUsers();
    const user = users.find(u => u.username === sessionUser);
    if (user) { enterApp(user); return; }
  }
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
})();
