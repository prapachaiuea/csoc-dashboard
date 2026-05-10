# CSOC Dashboard

A local Flask web dashboard that brings all CSOC daily tools into one browser tab. Replaces running individual `.bat` files with a unified interface featuring real-time log output, one-click downloads, and no visible terminal windows.

---

## Features

- **IT Monitor** — Start/stop the SOAR alert monitor, view live log stream
- **PromptCare Scraper** — Paste ticket IDs, run scraper, download color-coded Excel report
- **Shift Summary** — Generate shift handoff Excel report in one click
- **Weekly Summary** — Upload `data.ods`, run Stage 1 + Stage 2, download ZIP of all reports
- Real-time log streaming via Server-Sent Events (SSE)
- One-click server restart from the browser
- Dark glassmorphism UI

---

## Setup

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Folder structure
This dashboard expects its sibling tool folders to be present at the same level:
```
parent/
├── dashboard/          ← this repo
├── IT_MONITOR/
├── Shift summary/
├── ScalpingPromptcare/
└── WeeklySummary/
```

Each tool folder must have its own credentials configured (see that tool's README).

### 3. Run
```bash
python app.py
```
Or double-click `run.bat`. The browser opens automatically at `http://127.0.0.1:5000`.

**Silent mode (no terminal window):**
Double-click `launch_silent.vbs`.

---

## Restarting the Server

| Method | When to use |
|--------|-------------|
| Click **↺ Restart** in the dashboard header | Normal daily use |
| Double-click `restart.bat` | If the browser won't load |
| Double-click `run.bat` | Debug mode (shows terminal) |

---

## Requirements

- Python 3.10+
- All sibling tool repos cloned / present at the same parent level
- Each tool configured with its own credentials
