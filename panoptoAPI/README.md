# Custom Panopto API & Cortex Sync Agent

A production-grade, unattended Linux synchronization agent built in Python that automatically acquires NC State Panopto lecture transcripts and pushes them to Cortex.

Designed to run as a scheduled `systemd` timer (every 15 minutes) on a Proxmox Debian/Ubuntu server without manual intervention.

---

## Key Architectural Principles

1. **Intentionally Dumb Connector:** The sync agent only discovers recordings, checks caption availability, computes content hashes, and pushes transcripts to Cortex. Cortex owns academic knowledge processing, segmentation, embeddings, and search.
2. **No Duplicate Transcript Archive:** Transcripts are held temporarily in memory, pushed to Cortex, and immediately discarded upon HTTP acknowledgement. A local spool only buffers payloads if Cortex is temporarily unreachable.
3. **1:1 Course-to-Folder Mapping:** Each course in Cortex explicitly maps to a single Panopto folder ID.
4. **Account Lockout Protection (Circuit Breaker):** If authentication fails 3 consecutive times, the agent automatically halts and engages an emergency stop flag (`.auth_locked`) to prevent locking your NC State Unity account.
5. **External Duo Approval:** Relies on your external `duoapprove` service. The agent submits credentials, waits up to 25 seconds for push acceptance, automatically dismisses post-approval prompts ("Skip for now", "Trust device"), and resumes without human interaction.
6. **Strict Idempotency:** Ingested sessions are tracked locally in an operational SQLite database by `provider_session_id` and normalized `SHA-256` content hash. Unchanged lectures are skipped on subsequent runs.

---

## Repository Structure

```text
panoptoAPI/
├── pyproject.toml              # Build & dependency specifications
├── README.md                   # Complete deployment & operations guide
├── .gitignore
├── src/
│   └── custom_panopto/
│       ├── __init__.py
│       ├── __main__.py         # python -m custom_panopto entrypoint
│       ├── cli.py              # CLI subcommands: sync, auth-test, doctor, backfill
│       ├── config.py           # Configuration loading, defaults, and directory resolution
│       ├── auth.py             # Playwright persistent context, NC State SSO & Duo handler
│       ├── panopto.py          # Authenticated Panopto web client (sessions & captions)
│       ├── cortex.py           # Cortex HTTP client (manifest fetch & transcript ingest)
│       ├── state.py            # SQLite state DB & transcript normalization / SHA-256
│       ├── spool.py            # Retry spool with dead-letter quarantine for 4xx errors
│       └── sync.py             # Main synchronization coordinator with file locking
├── tests/                      # Full automated test suite (mocked Cortex & Panopto)
└── deploy/
    ├── custom-panopto.service  # Hardened systemd oneshot service
    ├── custom-panopto.timer    # 15-minute systemd timer
    └── custom-panopto.env.example
```

---

## Deployment on Debian / Ubuntu (Proxmox VM)

### 1. Prerequisites
Ensure Python 3.11+ and git are installed:
```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git
```

### 2. Create Dedicated Service User
```bash
sudo useradd -r -s /usr/sbin/nologin -d /var/lib/custom-panopto panopto-sync
```

### 3. Create Runtime Directories & Permissions
```bash
sudo mkdir -p /var/lib/custom-panopto/browser
sudo mkdir -p /var/lib/custom-panopto/spool
sudo chown -R panopto-sync:panopto-sync /var/lib/custom-panopto
sudo chmod -R 0700 /var/lib/custom-panopto

sudo mkdir -p /etc/custom-panopto
sudo chmod 0750 /etc/custom-panopto
```

### 4. Clone Repository & Install Virtual Environment
```bash
sudo mkdir -p /opt/custom-panopto
sudo chown -R $USER:$USER /opt/custom-panopto
cd /opt/custom-panopto

git clone <repo-url> .
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e .

# Install Playwright Chromium and OS library dependencies
playwright install chromium
playwright install-deps chromium
```

### 5. Configure Credentials
Copy the example environment file:
```bash
sudo cp deploy/custom-panopto.env.example /etc/custom-panopto/env
sudo chown root:panopto-sync /etc/custom-panopto/env
sudo chmod 0640 /etc/custom-panopto/env
sudo nano /etc/custom-panopto/env
```
Populate:
```ini
NCSU_USERNAME=your_unity_id
NCSU_PASSWORD=your_unity_password
CORTEX_BASE_URL=https://cortex.yourdomain.com
CORTEX_CONNECTOR_TOKEN=your_bearer_token
```

---

## Verification & Diagnostic Commands

Run diagnostics as the service user to verify permissions, Playwright, and configuration:

```bash
# 1. Run doctor (checks permissions, config, SQLite, and Cortex connectivity)
sudo -u panopto-sync /opt/custom-panopto/.venv/bin/python -m custom_panopto doctor --env-file /etc/custom-panopto/env

# 2. Test NC State authentication & Duo approval
sudo -u panopto-sync /opt/custom-panopto/.venv/bin/python -m custom_panopto auth-test --env-file /etc/custom-panopto/env

# 3. Perform a single manual sync run
sudo -u panopto-sync /opt/custom-panopto/.venv/bin/python -m custom_panopto sync --env-file /etc/custom-panopto/env
```

---

## Installing the `systemd` Timer

Deploy the oneshot service and timer to automate execution every 15 minutes:

```bash
sudo cp deploy/custom-panopto.service /etc/systemd/system/
sudo cp deploy/custom-panopto.timer /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now custom-panopto.timer
```

### Checking Status & Logs

```bash
# Check timer schedule
systemctl list-timers custom-panopto.timer

# Check last service execution
systemctl status custom-panopto.service

# Inspect live journald logs
journalctl -u custom-panopto.service -f
```

---

## Operational Procedures

### Unlocking the Circuit Breaker
If the circuit breaker activates after 3 failed login attempts:
```bash
# 1. Verify password in /etc/custom-panopto/env
# 2. Remove lock file
sudo rm /var/lib/custom-panopto/.auth_locked
```

### Forcing a Full Semester Backfill
To re-evaluate all recordings back to `syncSince`:
```bash
sudo -u panopto-sync /opt/custom-panopto/.venv/bin/python -m custom_panopto backfill --env-file /etc/custom-panopto/env
```

### Resetting Persistent Browser Session
If the Chromium browser profile ever becomes corrupted:
```bash
sudo rm -rf /var/lib/custom-panopto/browser/*
```
The agent will cleanly perform a fresh SSO login on the next run.
