"""Unit tests for authentication logic and circuit breaker behavior."""

import pytest

from custom_panopto.auth import AuthCircuitBreakerError, AuthError, AuthSessionManager
from custom_panopto.config import Config
from custom_panopto.state import StateDatabase


@pytest.mark.asyncio
async def test_auth_circuit_breaker_active(test_config: Config, state_db: StateDatabase):
    test_config.set_auth_locked("Test lock")
    manager = AuthSessionManager(test_config, state_db)

    with pytest.raises(AuthCircuitBreakerError):
        await manager.get_authenticated_cookies()


@pytest.mark.asyncio
async def test_auth_missing_credentials(test_config: Config, state_db: StateDatabase):
    test_config.ncsu_username = ""
    test_config.ncsu_password = ""

    manager = AuthSessionManager(test_config, state_db)
    # Circuit breaker shouldn't fire, but login should fail for missing credentials
    assert not test_config.is_auth_locked()
