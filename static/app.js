/* ── Clock ───────────────────────────────────────────── */
function updateClock() {
  document.getElementById('clock').textContent = new Date().toTimeString().slice(0, 8);
}
setInterval(updateClock, 1000);
updateClock();

/* ── Page Navigation ─────────────────────────────────── */
const TOOLS = ['monitor', 'scraper', 'shift', 'weekly'];

function showPage(tool) {
  TOOLS.forEach(t => {
    document.getElementById('page-' + t).classList.remove('active');
    document.getElementById('nav-' + t).classList.remove('active');
  });
  document.getElementById('page-' + tool).classList.add('active');
  document.getElementById('nav-' + tool).classList.add('active');
}

/* ── Status Polling ──────────────────────────────────── */
async function pollStatus() {
  try {
    const data = await fetch('/api/status').then(r => r.json());

    // Shift badge
    const badge = document.getElementById('shiftBadge');
    badge.textContent = data.shift + ' Shift';
    badge.className = 'shift-badge ' + (data.shift === 'DAY' ? 'day' : 'night');

    applyStatus('monitor', data.monitor.running);
    applyStatus('shift',   data.shift  ?.running);
    applyStatus('scraper', data.scraper.running);
    applyStatus('weekly',  data.weekly ?.running);
  } catch (_) {}
}

function applyStatus(tool, running) {
  const dot = document.getElementById('dot-' + tool);
  if (!dot) return;
  if (running) {
    dot.className = 'nav-dot running';
    setPill(tool, 'running', 'Running');
  }
  // Don't reset to idle here — let exit events handle it
}

setInterval(pollStatus, 4000);
pollStatus();

/* ── SSE Streams ─────────────────────────────────────── */
function connectStream(tool) {
  const es = new EventSource('/api/' + tool + '/stream');
  es.onmessage = e => {
    const entry = JSON.parse(e.data);
    if (!entry.m) return;
    appendLog(tool, entry.t, entry.m);
  };
  es.onerror = () => { es.close(); setTimeout(() => connectStream(tool), 3000); };
}
TOOLS.forEach(connectStream);

// Server log stream
(function () {
  const es = new EventSource('/api/server/stream');
  es.onmessage = e => {
    const entry = JSON.parse(e.data);
    if (!entry.m) return;
    const c = document.getElementById('log-server');
    const ph = c.querySelector('.terminal-placeholder');
    if (ph) ph.remove();
    const line = document.createElement('span');
    line.className = 'log-line dim';
    line.innerHTML = `<span class="ts">${entry.t}</span><span class="msg">${esc(entry.m)}</span>`;
    c.appendChild(line);
    c.scrollTop = c.scrollHeight;
  };
  es.onerror = () => { es.close(); setTimeout(arguments.callee, 3000); };
})();

/* ── Log Rendering ───────────────────────────────────── */
function classify(msg) {
  if (!msg) return 'dim';
  if (msg.startsWith('__EXIT__')) return msg.endsWith('0') ? 'exit-ok' : 'exit-err';
  const m = msg.toLowerCase();
  if (m.includes('🚨') || m.includes('critical') || m.includes('alert')) return 'alert';
  if (m.includes('❌') || m.includes('error') || m.includes('fail'))      return 'error';
  if (m.includes('✅') || m.includes('done') || m.includes('success'))     return 'ok';
  if (m.includes('⚠️') || m.includes('warn') || m.includes('skip'))       return 'warn';
  if (m.includes('─') || m.includes('page') || m.includes('debug'))       return 'dim';
  return 'info';
}

function fmtMsg(msg) {
  if (msg.startsWith('__EXIT__')) {
    const code = msg.slice(8);
    return code === '0' ? '✔  Finished successfully' : `✘  Exited with code ${code}`;
  }
  return msg;
}

function appendLog(tool, ts, msg) {
  const c = document.getElementById('log-' + tool);
  if (!c) return;
  const ph = c.querySelector('.terminal-placeholder');
  if (ph) ph.remove();

  const cls = classify(msg);
  const line = document.createElement('span');
  line.className = 'log-line ' + cls;
  line.innerHTML = `<span class="ts">${ts}</span><span class="msg">${esc(fmtMsg(msg))}</span>`;
  c.appendChild(line);

  if (msg.startsWith('__EXIT__')) {
    c.appendChild(document.createElement('br'));
    if (cls === 'exit-ok') {
      setPill(tool, 'done', 'Done');
      setNavDot(tool, 'done');
      enableDownload(tool);
    } else {
      setPill(tool, 'error', 'Error');
      setNavDot(tool, 'error');
    }
    setRunning(tool, false);
  }

  c.scrollTop = c.scrollHeight;
}

function clearLog(tool) {
  document.getElementById('log-' + tool).innerHTML = '';
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── UI Helpers ──────────────────────────────────────── */
function setPill(tool, cls, label) {
  const el = document.getElementById('status-' + tool);
  if (!el) return;
  el.className = 'status-pill ' + cls;
  el.querySelector('.label').textContent = label;
}

function setNavDot(tool, cls) {
  const d = document.getElementById('dot-' + tool);
  if (d) d.className = 'nav-dot ' + cls;
}

function setRunning(tool, running) {
  const starts = document.querySelectorAll(`[id^="${tool}-"]`);
  // specific per tool
  const startBtn = document.getElementById(tool + '-start') ||
                   document.getElementById(tool + '-run')   ||
                   document.getElementById(tool + '-stage1');
  const stopBtn  = document.getElementById(tool + '-stop');
  if (startBtn) startBtn.disabled = running;
  if (stopBtn)  stopBtn.disabled  = !running;

  // shift-specific
  if (tool === 'shift') {
    document.getElementById('shift-run').disabled = running;
  }
  // weekly-specific
  if (tool === 'weekly') {
    const s1 = document.getElementById('weekly-stage1');
    const s2 = document.getElementById('weekly-stage2');
    if (s1) s1.disabled = running;
    if (s2) s2.disabled = running;
  }
}

function enableDownload(tool) {
  const dl = document.getElementById(tool + '-dl');
  if (dl) dl.disabled = false;
  if (tool === 'weekly') {
    const wdl = document.getElementById('weekly-dl');
    if (wdl) wdl.disabled = false;
  }
}

/* ── IT Monitor ──────────────────────────────────────── */
async function monitorStart() {
  const res = await fetch('/api/monitor/start', {method:'POST'}).then(r=>r.json());
  if (!res.ok) { toast(res.reason || 'Already running', 'error'); return; }
  setPill('monitor', 'running', 'Running');
  setNavDot('monitor', 'running');
  setRunning('monitor', true);
  toast('Monitor started', 'ok');
}

async function monitorStop() {
  await fetch('/api/monitor/stop', {method:'POST'});
  setPill('monitor', 'idle', 'Offline');
  setNavDot('monitor', '');
  setRunning('monitor', false);
  toast('Stop signal sent', 'info');
}

/* ── Shift Summary ───────────────────────────────────── */
async function shiftRun() {
  const res = await fetch('/api/shift/run', {method:'POST'}).then(r=>r.json());
  if (!res.ok) { toast(res.reason || 'Already running', 'error'); return; }
  setPill('shift', 'running', 'Running');
  setNavDot('shift', 'running');
  setRunning('shift', true);
  document.getElementById('shift-dl').disabled = true;
  toast('Shift summary started', 'ok');
  loadShiftFiles();
}

async function shiftStop() {
  await fetch('/api/shift/stop', {method:'POST'});
  setRunning('shift', false);
  toast('Stop signal sent', 'info');
}

async function loadShiftFiles() {
  try {
    const data = await fetch('/api/shift/files').then(r => r.json());
    const hint = document.getElementById('shift-files-hint');
    if (data.files && data.files.length > 0) {
      hint.textContent = 'Latest: ' + data.files[0];
    }
  } catch (_) {}
}

/* ── PromptCare Scraper ──────────────────────────────── */
async function scraperRun() {
  const tickets = document.getElementById('ticket-input').value.trim();
  const res = await fetch('/api/scraper/run', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({tickets}),
  }).then(r => r.json());
  if (!res.ok) { toast(res.reason || 'Already running', 'error'); return; }
  setPill('scraper', 'running', 'Running');
  setNavDot('scraper', 'running');
  setRunning('scraper', true);
  document.getElementById('scraper-dl').disabled = true;
  toast('Scraper started', 'ok');
}

async function scraperStop() {
  await fetch('/api/scraper/stop', {method:'POST'});
  setRunning('scraper', false);
  toast('Stop signal sent', 'info');
}

async function loadTickets() {
  const data = await fetch('/api/scraper/tickets').then(r => r.json());
  document.getElementById('ticket-input').value = data.tickets;
  updateTicketCount();
  toast('Loaded from Ticket.txt', 'info');
}

function clearTickets() {
  document.getElementById('ticket-input').value = '';
  updateTicketCount();
}

function updateTicketCount() {
  const val = document.getElementById('ticket-input').value;
  const n = val.trim() === '' ? 0 : val.trim().split('\n').filter(l => l.trim()).length;
  document.getElementById('ticketCount').textContent = n + ' ticket' + (n !== 1 ? 's' : '');
}

document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('ticket-input');
  if (ta) ta.addEventListener('input', updateTicketCount);
  loadShiftFiles();
  checkWeeklyStatus();
  setupOdsUpload();
});

/* ── ODS Upload ──────────────────────────────────────── */
function setupOdsUpload() {
  const input = document.getElementById('ods-upload');
  const label = document.getElementById('ods-upload-label');
  if (!input || !label) return;

  input.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) uploadOds(f);
  });

  label.addEventListener('dragover', e => {
    e.preventDefault();
    label.classList.add('drag');
  });
  label.addEventListener('dragleave', () => label.classList.remove('drag'));
  label.addEventListener('drop', e => {
    e.preventDefault();
    label.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if (f) uploadOds(f);
  });
}

async function uploadOds(file) {
  const label = document.getElementById('ods-upload-label');
  const orig = label.innerHTML;
  label.innerHTML = '<span class="upload-text">⏳ Uploading…</span>';
  label.style.pointerEvents = 'none';

  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/weekly/upload', {method:'POST', body:fd}).then(r=>r.json());
    if (res.ok) {
      label.innerHTML = '<span class="upload-text">✅ ' + res.filename + ' uploaded</span>';
      toast('File uploaded successfully', 'ok');
      setTimeout(() => { label.innerHTML = orig; label.style.pointerEvents = 'auto'; }, 3000);
      checkWeeklyStatus();
    } else {
      toast(res.error || 'Upload failed', 'error');
      label.innerHTML = orig;
      label.style.pointerEvents = 'auto';
    }
  } catch (e) {
    toast('Upload error: ' + e, 'error');
    label.innerHTML = orig;
    label.style.pointerEvents = 'auto';
  }
}

/* ── Weekly Summary ──────────────────────────────────── */
async function weeklyStage1() {
  const res = await fetch('/api/weekly/stage1', {method:'POST'}).then(r=>r.json());
  if (!res.ok) { toast(res.reason || 'Already running', 'error'); return; }
  setPill('weekly', 'running', 'Running');
  setNavDot('weekly', 'running');
  setRunning('weekly', true);
  document.getElementById('weekly-dl').disabled = true;
  toast('Stage 1 started', 'ok');
}

async function weeklyStage2() {
  const res = await fetch('/api/weekly/stage2', {method:'POST'}).then(r=>r.json());
  if (!res.ok) { toast(res.reason || 'Already running', 'error'); return; }
  setPill('weekly', 'running', 'Running');
  setNavDot('weekly', 'running');
  setRunning('weekly', true);
  toast('Stage 2 started', 'ok');
}

async function weeklyStop() {
  await fetch('/api/weekly/stop', {method:'POST'});
  setRunning('weekly', false);
  toast('Stop signal sent', 'info');
}

async function checkWeeklyStatus() {
  try {
    const data = await fetch('/api/weekly/status').then(r => r.json());
    const odsEl = document.getElementById('ods-status');
    if (data.ods) {
      odsEl.className = 'ods-status found';
      odsEl.textContent = '✔ data.ods found';
    } else {
      odsEl.className = 'ods-status missing';
      odsEl.textContent = '✘ data.ods missing';
    }
    const xlsxEl = document.getElementById('xlsx-status');
    if (xlsxEl) {
      xlsxEl.textContent = data.xlsx_count > 0
        ? `${data.xlsx_count} file${data.xlsx_count !== 1 ? 's' : ''} ready`
        : 'No files yet';
      if (data.xlsx_count > 0) document.getElementById('weekly-dl').disabled = false;
    }
  } catch (_) {}
}
setInterval(checkWeeklyStatus, 10000);

/* ── Download ────────────────────────────────────────── */
function download(tool) {
  const map = { monitor: null, scraper: 'scraper', shift: 'shift', weekly: 'weekly' };
  if (!map[tool]) return;
  window.location.href = '/api/' + map[tool] + '/download';
}

/* ── Restart ─────────────────────────────────────────── */
async function restartServer() {
  const btn = document.getElementById('restart-btn');
  btn.disabled = true;
  btn.textContent = '↺ Restarting…';
  await fetch('/api/restart', {method:'POST'});
  toast('Restarting — reloading in 3s…', 'info');
  setTimeout(() => location.reload(), 3500);
}

/* ── Server Log Toggle ───────────────────────────────── */
let serverLogOpen = false;
function toggleServerLog() {
  serverLogOpen = !serverLogOpen;
  document.getElementById('serverLogPanel').classList.toggle('open', serverLogOpen);
  document.getElementById('serverLogArrow').classList.toggle('open', serverLogOpen);
}

/* ── Toast ───────────────────────────────────────────── */
let toastTimer = null;
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
