import os, sys, threading, queue, time, json, subprocess, logging, zipfile, glob
from collections import deque
from flask import Flask, render_template, jsonify, request, Response, send_file

_UTF8_ENV = {**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'}

app = Flask(__name__)

# ── Werkzeug log capture ──────────────────────────────────────────────────────
_server_logs = deque(maxlen=300)
_server_subs = []

class _BrowserLogHandler(logging.Handler):
    def emit(self, record):
        entry = {'t': time.strftime('%H:%M:%S'), 'm': self.format(record)}
        _server_logs.append(entry)
        dead = []
        for q in _server_subs:
            try: q.put_nowait(entry)
            except: dead.append(q)
        for q in dead:
            try: _server_subs.remove(q)
            except: pass

_h = _BrowserLogHandler()
_h.setFormatter(logging.Formatter('%(message)s'))
logging.getLogger('werkzeug').addHandler(_h)
logging.getLogger('werkzeug').setLevel(logging.INFO)

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DIRS = {
    'monitor': os.path.join(BASE, 'IT_MONITOR'),
    'scraper': os.path.join(BASE, 'ScalpingPromptcare'),
    'shift':   os.path.join(BASE, 'Shift summary'),
    'weekly':  os.path.join(BASE, 'WeeklySummary'),
}

TOOLS = ['monitor', 'scraper', 'shift', 'weekly']

state = {t: {'proc': None, 'running': False, 'logs': deque(maxlen=500),
              'subs': [], 'lock': threading.Lock()} for t in TOOLS}

# ── Helpers ───────────────────────────────────────────────────────────────────
def push(tool, msg):
    entry = {'t': time.strftime('%H:%M:%S'), 'm': msg}
    s = state[tool]
    s['logs'].append(entry)
    dead = []
    for q in s['subs']:
        try: q.put_nowait(entry)
        except: dead.append(q)
    for q in dead:
        try: s['subs'].remove(q)
        except: pass

def run_script(tool, args, cwd):
    s = state[tool]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, encoding='utf-8', errors='replace',
                             cwd=cwd, env=_UTF8_ENV)
    with s['lock']:
        s['proc'] = proc
    for line in iter(proc.stdout.readline, ''):
        line = line.rstrip('\r\n')
        if line:
            push(tool, line)
    proc.wait()
    return proc.returncode

def start_tool(tool, run_fn):
    s = state[tool]
    with s['lock']:
        if s['running']:
            return False
        s['running'] = True
        s['logs'].clear()
    def wrapper():
        try:
            run_fn()
        except Exception as e:
            push(tool, f'__EXIT__1')
            push(tool, f'Error: {e}')
        finally:
            with s['lock']:
                s['running'] = False
                s['proc'] = None
    threading.Thread(target=wrapper, daemon=True).start()
    return True

def stop_tool(tool):
    s = state[tool]
    with s['lock']:
        if s['proc']:
            s['proc'].terminate()

# ── IT Monitor ────────────────────────────────────────────────────────────────
@app.route('/api/monitor/start', methods=['POST'])
def monitor_start():
    def run():
        push('monitor', '🚀 Starting SOAR monitor...')
        rc = run_script('monitor', [sys.executable, '-u',
                        os.path.join(DIRS['monitor'], 'monitor_api.py')], DIRS['monitor'])
        push('monitor', f'__EXIT__{rc}')
    ok = start_tool('monitor', run)
    return jsonify({'ok': ok})

@app.route('/api/monitor/stop', methods=['POST'])
def monitor_stop():
    stop_tool('monitor')
    return jsonify({'ok': True})

# ── PromptCare Scraper ────────────────────────────────────────────────────────
@app.route('/api/scraper/run', methods=['POST'])
def scraper_run():
    tickets = (request.json or {}).get('tickets', '').strip()
    def run():
        if tickets:
            with open(os.path.join(DIRS['scraper'], 'Ticket.txt'), 'w', encoding='utf-8') as f:
                f.write(tickets)
            push('scraper', f'📋 Wrote {len(tickets.splitlines())} ticket IDs')
        push('scraper', '🚀 Starting scraper...')
        rc1 = run_script('scraper', [sys.executable, '-u',
                         os.path.join(DIRS['scraper'], 'scripts', 'PromptCare-Text.py')], DIRS['scraper'])
        if rc1 == 0:
            push('scraper', '✅ Scraping done — highlighting...')
            rc2 = run_script('scraper', [sys.executable, '-u',
                             os.path.join(DIRS['scraper'], 'scripts', 'highlight_ticket.py')], DIRS['scraper'])
            push('scraper', f'__EXIT__{rc2}')
        else:
            push('scraper', f'❌ Failed (exit {rc1})')
            push('scraper', f'__EXIT__{rc1}')
    ok = start_tool('scraper', run)
    return jsonify({'ok': ok})

@app.route('/api/scraper/stop', methods=['POST'])
def scraper_stop():
    stop_tool('scraper')
    return jsonify({'ok': True})

@app.route('/api/scraper/download')
def scraper_download():
    path = os.path.join(DIRS['scraper'], 'output', 'output_highlight.xlsx')
    if os.path.exists(path):
        return send_file(path, as_attachment=True, download_name='PromptCare_Report.xlsx')
    return jsonify({'error': 'Not found'}), 404

@app.route('/api/scraper/tickets')
def scraper_tickets():
    p = os.path.join(DIRS['scraper'], 'Ticket.txt')
    return jsonify({'tickets': open(p, encoding='utf-8').read() if os.path.exists(p) else ''})

# ── Shift Summary ─────────────────────────────────────────────────────────────
@app.route('/api/shift/run', methods=['POST'])
def shift_run():
    def run():
        push('shift', '🚀 Generating shift summary...')
        rc = run_script('shift', [sys.executable, '-u',
                        os.path.join(DIRS['shift'], 'main.py')], DIRS['shift'])
        push('shift', f'__EXIT__{rc}')
    ok = start_tool('shift', run)
    return jsonify({'ok': ok})

@app.route('/api/shift/stop', methods=['POST'])
def shift_stop():
    stop_tool('shift')
    return jsonify({'ok': True})

@app.route('/api/shift/download')
def shift_download():
    out = os.path.join(DIRS['shift'], 'output')
    files = sorted(glob.glob(os.path.join(out, '*.xlsx')), key=os.path.getmtime, reverse=True)
    if files:
        return send_file(files[0], as_attachment=True,
                         download_name=os.path.basename(files[0]))
    return jsonify({'error': 'No report found — run first'}), 404

@app.route('/api/shift/files')
def shift_files():
    out = os.path.join(DIRS['shift'], 'output')
    files = sorted(glob.glob(os.path.join(out, '*.xlsx')), key=os.path.getmtime, reverse=True)
    return jsonify({'files': [os.path.basename(f) for f in files]})

# ── Weekly Summary ────────────────────────────────────────────────────────────
WEEKLY_STAGE1 = [
    '1ChartPie.py', 'ChartSeverity.py', '1Extrahop.py',
    '2CrowdstrikeResolvedNotCymulate.py', '3Crowdstrikependingandworkinprogress.py',
    '4SplunkResolved.py', '5Splunkpending.py', '6SplunkCymulate.py', '7CrowdstrikeCymulate.py',
]

@app.route('/api/weekly/stage1', methods=['POST'])
def weekly_stage1():
    def run():
        push('weekly', '🚀 Stage 1 — Processing data.ods...')
        ods = os.path.join(DIRS['weekly'], 'data.ods')
        if not os.path.exists(ods):
            push('weekly', '❌ data.ods not found — place it in the WeeklySummary folder')
            push('weekly', '__EXIT__1')
            return
        for script in WEEKLY_STAGE1:
            path = os.path.join(DIRS['weekly'], script)
            push('weekly', f'▶ Running {script}...')
            rc = run_script('weekly', [sys.executable, '-u', path], DIRS['weekly'])
            if rc != 0:
                push('weekly', f'❌ {script} failed (exit {rc})')
                push('weekly', f'__EXIT__{rc}')
                return
        push('weekly', '✅ Stage 1 complete!')
        push('weekly', '__EXIT__0')
    ok = start_tool('weekly', run)
    return jsonify({'ok': ok})

@app.route('/api/weekly/stage2', methods=['POST'])
def weekly_stage2():
    def run():
        push('weekly', '📊 Stage 2 — Building presentation...')
        rc = run_script('weekly', [sys.executable, '-u',
                        os.path.join(DIRS['weekly'], 'Createpresentation.py')], DIRS['weekly'])
        push('weekly', f'__EXIT__{rc}')
    ok = start_tool('weekly', run)
    return jsonify({'ok': ok})

@app.route('/api/weekly/stop', methods=['POST'])
def weekly_stop():
    stop_tool('weekly')
    return jsonify({'ok': True})

@app.route('/api/weekly/download')
def weekly_download():
    pf = os.path.join(DIRS['weekly'], 'Presentation Final')
    files = glob.glob(os.path.join(pf, '*.xlsx'))
    if not files:
        return jsonify({'error': 'No files found — run Stage 2 first'}), 404
    zip_path = os.path.join(DIRS['weekly'], 'WeeklySummary.zip')
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, os.path.basename(f))
    return send_file(zip_path, as_attachment=True, download_name='WeeklySummary.zip')

@app.route('/api/weekly/upload', methods=['POST'])
def weekly_upload():
    if 'file' not in request.files:
        return jsonify({'ok': False, 'error': 'No file provided'}), 400
    f = request.files['file']
    if f.filename == '':
        return jsonify({'ok': False, 'error': 'No file selected'}), 400
    if not f.filename.endswith('.ods'):
        return jsonify({'ok': False, 'error': 'Only .ods files allowed'}), 400
    try:
        path = os.path.join(DIRS['weekly'], 'data.ods')
        f.save(path)
        return jsonify({'ok': True, 'filename': f.filename})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/weekly/status')
def weekly_status():
    ods_exists = os.path.exists(os.path.join(DIRS['weekly'], 'data.ods'))
    pf = os.path.join(DIRS['weekly'], 'Presentation Final')
    xlsx_count = len(glob.glob(os.path.join(pf, '*.xlsx')))
    return jsonify({'ods': ods_exists, 'xlsx_count': xlsx_count})

# ── SSE Streams ───────────────────────────────────────────────────────────────
@app.route('/api/<tool>/stream')
def stream(tool):
    if tool not in state:
        return 'Not found', 404
    s = state[tool]
    q = queue.Queue()
    def generate():
        for entry in list(s['logs']):
            yield f"data: {json.dumps(entry)}\n\n"
        s['subs'].append(q)
        try:
            while True:
                try:
                    yield f"data: {json.dumps(q.get(timeout=25))}\n\n"
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            try: s['subs'].remove(q)
            except: pass
    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

@app.route('/api/server/stream')
def server_stream():
    q = queue.Queue()
    def generate():
        for entry in list(_server_logs):
            yield f"data: {json.dumps(entry)}\n\n"
        _server_subs.append(q)
        try:
            while True:
                try:
                    yield f"data: {json.dumps(q.get(timeout=25))}\n\n"
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            try: _server_subs.remove(q)
            except: pass
    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

# ── Restart ───────────────────────────────────────────────────────────────────
@app.route('/api/restart', methods=['POST'])
def restart():
    vbs = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'launch_silent.vbs')
    def do():
        time.sleep(1)
        subprocess.Popen(['wscript.exe', vbs], close_fds=True)
    threading.Thread(target=do, daemon=True).start()
    return jsonify({'ok': True})

# ── Status ────────────────────────────────────────────────────────────────────
@app.route('/api/status')
def all_status():
    import datetime
    hour = datetime.datetime.now().hour
    shift = 'DAY' if 8 <= hour < 20 else 'NIGHT'
    return jsonify({t: {'running': state[t]['running']} for t in TOOLS} | {'shift': shift})

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    print('SOC Dashboard starting at http://127.0.0.1:5000')
    app.run(debug=False, host='127.0.0.1', port=5000, threaded=True)
