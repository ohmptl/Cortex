"""Command-line interface for Custom Panopto API."""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path
import httpx

from .auth import AuthSessionManager
from .config import get_config
from .cortex import CortexClient
from .state import StateDatabase
from .sync import SyncCoordinator


def setup_logging(level_name: str = "INFO") -> None:
    """Configure clean structured console logging."""
    level = getattr(logging, level_name.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


async def cmd_sync(args: argparse.Namespace) -> int:
    """Execute a single synchronization pass."""
    config = get_config(args.env_file)
    setup_logging(config.log_level)
    coordinator = SyncCoordinator(config)
    summary = await coordinator.run(force_recheck=getattr(args, "force", False))
    return 1 if summary.errors > 0 else 0


async def cmd_auth_test(args: argparse.Namespace) -> int:
    """Validate NC State authentication and test Panopto session viability."""
    config = get_config(args.env_file)
    setup_logging("INFO")
    logger = logging.getLogger("custom_panopto.auth-test")

    print("\n=== NC State / Panopto Authentication Test ===")
    if config.is_auth_locked():
        print(f"[FAIL] Circuit breaker is active: {config.circuit_breaker_file}")
        print("Resolve credentials and delete the lock file to proceed.")
        return 1

    state_db = StateDatabase(config.state_db)
    auth_mgr = AuthSessionManager(config, state_db)

    try:
        cookies = await auth_mgr.get_authenticated_cookies()
        print(f"[OK] Authentication successful! Retrieved {len(cookies)} cookies.")
        has_auth_cookie = any(".ASPXAUTH" in k for k in cookies)
        print(f"     Session cookie (.ASPXAUTH) present: {'YES' if has_auth_cookie else 'NO'}")

        # Test Panopto web session via GetSessions service
        async with httpx.AsyncClient(cookies=cookies, timeout=15.0) as client:
            res = await client.post(
                f"{config.panopto_base_url}/Panopto/Services/Data.svc/GetSessions",
                json={"queryParameters": {"page": 0}},
                headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
            )
            if res.status_code == 200:
                results = res.json().get("d", {}).get("Results", [])
                print(f"[OK] Panopto session verified! Session library accessible ({len(results)} recordings listed).")
            else:
                print(f"[WARN] Panopto GetSessions returned status {res.status_code}")

        return 0

    except Exception as e:
        logger.error("Authentication test failed: %s", e)
        print(f"[FAIL] Authentication test failed: {e}")
        return 1


async def cmd_doctor(args: argparse.Namespace) -> int:
    """Run full system diagnostics on configuration, permissions, dependencies, and connectivity."""
    config = get_config(args.env_file)
    setup_logging("WARNING")
    print("\n=== Custom Panopto API Health Doctor ===")

    issues = 0

    # 1. Config check
    print("\n1. Configuration Check:")
    safe_cfg = config.safe_dict()
    for k, v in safe_cfg.items():
        print(f"   - {k}: {v}")

    if not config.ncsu_username or not config.ncsu_password:
        print("   [FAIL] NCSU_USERNAME or NCSU_PASSWORD is not set!")
        issues += 1
    else:
        print("   [OK] Credentials configured.")

    if not config.cortex_base_url:
        print("   [WARN] CORTEX_BASE_URL is not set.")
    else:
        print("   [OK] Cortex base URL configured.")

    # 2. Circuit breaker check
    print("\n2. Account Safety Circuit Breaker:")
    if config.is_auth_locked():
        print(f"   [FAIL] Circuit breaker ACTIVE ({config.circuit_breaker_file})")
        issues += 1
    else:
        print("   [OK] Circuit breaker clear.")

    # 3. Directory & Permission check
    print("\n3. Runtime Paths & Permissions:")
    for name, path in [
        ("Browser Profile", config.browser_profile_dir),
        ("State DB", config.state_db.parent),
        ("Spool Dir", config.spool_dir),
        ("Lock File Dir", config.lock_file.parent),
    ]:
        try:
            path.mkdir(parents=True, exist_ok=True)
            test_file = path / ".perm_check"
            test_file.write_text("ok", encoding="utf-8")
            test_file.unlink()
            print(f"   [OK] {name} ({path}): Writable")
        except Exception as ex:
            print(f"   [FAIL] {name} ({path}): Not writable ({ex})")
            issues += 1

    # 4. State Database Check
    print("\n4. Operational State Database:")
    try:
        state_db = StateDatabase(config.state_db)
        counts = state_db.count_by_status()
        print(f"   [OK] SQLite DB initialized at {config.state_db}")
        if counts:
            for st, cnt in counts.items():
                print(f"        - {st}: {cnt}")
        else:
            print("        - (No recorded sessions yet)")
    except Exception as ex:
        print(f"   [FAIL] State DB error: {ex}")
        issues += 1

    # 5. Spool Check
    print("\n5. Retry Spool:")
    active_spool = len(list(config.spool_dir.glob("*.json")))
    dead_letter = len(list((config.spool_dir / ".dead-letter").glob("*.json")))
    print(f"   - Active spool items: {active_spool}")
    print(f"   - Dead-letter items: {dead_letter}")

    # 6. Cortex Reachability Check
    print("\n6. Cortex Connectivity:")
    if config.cortex_base_url:
        try:
            cortex = CortexClient(config.cortex_base_url, config.cortex_connector_token, timeout_seconds=10.0)
            manifest = await cortex.get_manifest()
            print(f"   [OK] Reached Cortex! Discovered {len(manifest.courses)} mapped courses.")
        except Exception as ex:
            print(f"   [WARN] Could not reach Cortex: {ex}")
    else:
        print("   [INFO] Skipped (CORTEX_BASE_URL not set).")

    print("\n==========================================")
    if issues == 0:
        print("RESULT: Doctor check passed successfully with 0 critical issues.\n")
        return 0
    else:
        print(f"RESULT: Doctor check found {issues} issue(s) that need attention.\n")
        return 1


def main() -> None:
    """CLI parser and router."""
    common_parser = argparse.ArgumentParser(add_help=False)
    common_parser.add_argument(
        "--env-file",
        type=Path,
        default=None,
        help="Path to environment file (e.g. /etc/custom-panopto/env or .env)",
    )

    parser = argparse.ArgumentParser(
        prog="custom-panopto",
        description="Custom Panopto API & Cortex Sync Agent",
        parents=[common_parser],
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # sync
    sync_p = subparsers.add_parser(
        "sync", parents=[common_parser], help="Run a single synchronization cycle"
    )
    sync_p.add_argument("--force", action="store_true", help="Force recheck of all sessions")

    # auth-test
    subparsers.add_parser(
        "auth-test", parents=[common_parser], help="Test NC State login & Panopto session persistence"
    )

    # doctor
    subparsers.add_parser(
        "doctor", parents=[common_parser], help="Run system diagnostics & connectivity checks"
    )

    # backfill
    backfill_p = subparsers.add_parser(
        "backfill", parents=[common_parser], help="Run full semester backfill"
    )
    backfill_p.set_defaults(force=True)

    args = parser.parse_args()


    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        if args.command in ("sync", "backfill"):
            code = loop.run_until_complete(cmd_sync(args))
        elif args.command == "auth-test":
            code = loop.run_until_complete(cmd_auth_test(args))
        elif args.command == "doctor":
            code = loop.run_until_complete(cmd_doctor(args))
        else:
            parser.print_help()
            code = 1
    finally:
        loop.close()

    sys.exit(code)


if __name__ == "__main__":
    main()
