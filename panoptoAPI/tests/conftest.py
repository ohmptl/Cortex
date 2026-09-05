"""Shared pytest fixtures and test utilities."""

import pytest
from pathlib import Path
import tempfile
import shutil

from custom_panopto.config import Config
from custom_panopto.state import StateDatabase
from custom_panopto.spool import RetrySpool


@pytest.fixture
def temp_dir():
    """Create and yield a temporary directory, cleaned up after the test."""
    d = Path(tempfile.mkdtemp())
    try:
        yield d
    finally:
        shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def test_config(temp_dir):
    """Provide a isolated test configuration using temporary directories."""
    return Config(
        ncsu_username="testuser",
        ncsu_password="testpassword",
        panopto_base_url="https://ncsu.hosted.panopto.com",
        cortex_base_url="http://cortex.test",
        cortex_connector_token="test-token-123",
        browser_mode="headless",
        browser_profile_dir=temp_dir / "browser",
        state_db=temp_dir / "state.db",
        spool_dir=temp_dir / "spool",
        lock_file=temp_dir / "sync.lock",
        circuit_breaker_file=temp_dir / ".auth_locked",
        duo_timeout_seconds=2,
        max_auth_attempts=3,
        log_level="DEBUG",
    )


@pytest.fixture
def state_db(test_config):
    """Provide an initialized StateDatabase instance."""
    return StateDatabase(test_config.state_db)


@pytest.fixture
def retry_spool(test_config):
    """Provide an initialized RetrySpool instance."""
    return RetrySpool(test_config.spool_dir)
