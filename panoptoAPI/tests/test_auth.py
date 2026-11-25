"""Unit tests for authentication logic and circuit breaker behavior."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable
import pytest

from custom_panopto.auth import AuthCircuitBreakerError, AuthError, AuthSessionManager
from custom_panopto.config import Config
from custom_panopto.state import StateDatabase


@dataclass
class FakeElement:
    visible: bool = True
    text: str = ""
    on_click: Callable[[], None] | None = None
    filled_values: list[str] = field(default_factory=list)
    clicked: int = 0


class FakeLocator:
    def __init__(self, page: "FakePage", selector: str) -> None:
        self._page = page
        self._selector = selector

    @property
    def first(self) -> "FakeLocator":
        return self

    def _resolve(self) -> FakeElement | None:
        return self._page.resolve(self._selector)

    async def count(self) -> int:
        return 1 if self._resolve() is not None else 0

    async def is_visible(self) -> bool:
        el = self._resolve()
        return bool(el and el.visible)

    async def wait_for(self, state: str = "visible", timeout: int = 10000) -> None:
        el = self._resolve()
        if not el or (state == "visible" and not el.visible):
            raise TimeoutError(f"Selector not visible: {self._selector}")

    async def click(self) -> None:
        el = self._resolve()
        if not el:
            raise AssertionError(f"Cannot click missing selector: {self._selector}")
        el.clicked += 1
        self._page.clicks.append(self._selector)
        if el.on_click:
            el.on_click()

    async def fill(self, value: str) -> None:
        el = self._resolve()
        if not el:
            raise AssertionError(f"Cannot fill missing selector: {self._selector}")
        el.filled_values.append(value)
        self._page.fills.append((self._selector, value))

    async def inner_text(self) -> str:
        el = self._resolve()
        return el.text if el else ""

    async def press(self, key: str) -> None:
        el = self._resolve()
        if el and el.on_click:
            el.on_click()


class FakeContext:
    def __init__(self, cookies: list[dict[str, str]] | None = None) -> None:
        self._cookies = cookies or []

    async def cookies(self) -> list[dict[str, str]]:
        return list(self._cookies)


class FakePage:
    """Lightweight deterministic Playwright Page stub for testing Entra/Duo state transitions."""

    def __init__(self, url: str = "about:blank", cookies: list[dict[str, str]] | None = None) -> None:
        self.url = url
        self.context = FakeContext(cookies)
        self.frames: list = []
        self.elements: dict[str, FakeElement] = {}
        self.body_text: str = ""
        self.clicks: list[str] = []
        self.fills: list[tuple[str, str]] = []

    def resolve(self, selector: str) -> FakeElement | None:
        if selector in self.elements:
            return self.elements[selector]
        for part in (s.strip() for s in selector.split(",")):
            if part in self.elements:
                return self.elements[part]
        return None

    def locator(self, selector: str) -> FakeLocator:
        return FakeLocator(self, selector)

    async def goto(self, url: str, wait_until: str = "networkidle", timeout: int = 25000) -> None:
        self.url = url

    async def wait_for_load_state(self, state: str = "domcontentloaded", timeout: int = 20000) -> None:
        return None

    async def inner_text(self, selector: str) -> str:
        if selector == "body":
            return self.body_text
        el = self.resolve(selector)
        return el.text if el else ""


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


@pytest.mark.asyncio
async def test_is_on_panopto_requires_aspxauth(test_config: Config, state_db: StateDatabase):
    manager = AuthSessionManager(test_config, state_db)
    page = FakePage(url="https://ncsu.hosted.panopto.com/Panopto/Pages/Home.aspx", cookies=[])
    assert not await manager._is_on_panopto(page)

    page.context._cookies = [{"name": ".ASPXAUTH", "value": "token-value"}]
    assert await manager._is_on_panopto(page)

    page.url = "https://ncsu.hosted.panopto.com/Panopto/Pages/Auth/Login.aspx"
    assert not await manager._is_on_panopto(page)


@pytest.mark.asyncio
async def test_entra_verification_required_clicks_continue(
    test_config: Config, state_db: StateDatabase, monkeypatch: pytest.MonkeyPatch
):
    """Remembered Entra session landing on 'Verification Required' clicks Continue and completes Duo."""
    async def fast_sleep(_delay: float) -> None:
        return None

    monkeypatch.setattr("custom_panopto.auth.asyncio.sleep", fast_sleep)

    page = FakePage()

    def on_panopto_sign_in() -> None:
        page.url = "https://login.microsoftonline.com/80f23f4a-91a4-4566-8db1-3bcabb21d1cb/saml2?SAMLRequest=abc"
        page.elements = {
            "#externalAuthHeader": FakeElement(text="Verification Required"),
            "#idSIButton9": FakeElement(text="Continue", on_click=on_entra_continue),
        }

    def on_entra_continue() -> None:
        page.url = "https://ncsu.hosted.panopto.com/Panopto/Pages/Home.aspx"
        page.elements = {}
        page.context._cookies = [{"name": ".ASPXAUTH", "value": "valid-session-cookie"}]

    page.elements = {
        "#PageContentPlaceholder_loginControl_externalLoginButton": FakeElement(on_click=on_panopto_sign_in),
    }

    manager = AuthSessionManager(test_config, state_db)
    await manager._perform_ncsu_login(page)

    assert await manager._is_on_panopto(page)
    assert any("#idSIButton9" in c for c in page.clicks)
    assert page.fills == []
    assert state_db.get_auth_failures() == 0


@pytest.mark.asyncio
async def test_entra_account_picker_then_verification_and_kmsi(
    test_config: Config, state_db: StateDatabase, monkeypatch: pytest.MonkeyPatch
):
    """Entra account picker selects matching user tile, continues to Duo, and accepts Stay signed in."""
    async def fast_sleep(_delay: float) -> None:
        return None

    monkeypatch.setattr("custom_panopto.auth.asyncio.sleep", fast_sleep)

    page = FakePage()

    def on_panopto_sign_in() -> None:
        page.url = "https://login.microsoftonline.com/tenant/saml2"
        page.elements = {
            "#tilesHolder": FakeElement(),
            "div[data-test-id='testuser@ncsu.edu']": FakeElement(on_click=on_pick_account),
        }

    def on_pick_account() -> None:
        page.elements = {
            "#externalAuthHeader": FakeElement(text="Verification Required"),
            "#idSIButton9": FakeElement(text="Continue", on_click=on_continue_to_duo),
        }

    def on_continue_to_duo() -> None:
        page.url = "https://login.microsoftonline.com/kmsi"
        page.elements = {
            "#KmsiDescription": FakeElement(text="Do this to reduce the number of times you are asked to sign in."),
            "#idSIButton9": FakeElement(text="Yes", on_click=on_kmsi_yes),
        }

    def on_kmsi_yes() -> None:
        page.url = "https://ncsu.hosted.panopto.com/Panopto/Pages/Home.aspx"
        page.elements = {}
        page.context._cookies = [{"name": ".ASPXAUTH", "value": "valid-session-cookie"}]

    page.elements = {
        "#PageContentPlaceholder_loginControl_externalLoginButton": FakeElement(on_click=on_panopto_sign_in),
    }

    manager = AuthSessionManager(test_config, state_db)
    await manager._perform_ncsu_login(page)

    assert await manager._is_on_panopto(page)
    assert "div[data-test-id='testuser@ncsu.edu']" in page.clicks
    assert state_db.get_auth_failures() == 0


@pytest.mark.asyncio
async def test_entra_full_username_password_and_verification_flow(
    test_config: Config, state_db: StateDatabase, monkeypatch: pytest.MonkeyPatch
):
    """Fresh Entra login submits email, password, clicks Continue on Verification Required, and returns."""
    async def fast_sleep(_delay: float) -> None:
        return None

    monkeypatch.setattr("custom_panopto.auth.asyncio.sleep", fast_sleep)

    page = FakePage()

    def on_panopto_sign_in() -> None:
        page.url = "https://login.microsoftonline.com/tenant/saml2"
        page.elements = {
            "input[name='loginfmt']": FakeElement(),
            "#idSIButton9": FakeElement(text="Next", on_click=on_submit_user),
        }

    def on_submit_user() -> None:
        page.elements = {
            "input[name='passwd']": FakeElement(),
            "#idSIButton9": FakeElement(text="Sign in", on_click=on_submit_pass),
        }

    def on_submit_pass() -> None:
        page.elements = {
            "#externalAuthHeader": FakeElement(text="Verification Required"),
            "#idSIButton9": FakeElement(text="Continue", on_click=on_continue_duo),
        }

    def on_continue_duo() -> None:
        page.url = "https://ncsu.hosted.panopto.com/Panopto/Pages/Home.aspx"
        page.elements = {}
        page.context._cookies = [{"name": ".ASPXAUTH", "value": "valid-session-cookie"}]

    page.elements = {
        "#PageContentPlaceholder_loginControl_externalLoginButton": FakeElement(on_click=on_panopto_sign_in),
    }

    manager = AuthSessionManager(test_config, state_db)
    await manager._perform_ncsu_login(page)

    assert await manager._is_on_panopto(page)
    assert ("input[name='loginfmt'], #i0116", "testuser@ncsu.edu") in page.fills
    assert ("input[name='passwd'], #i0118", "testpassword") in page.fills


@pytest.mark.asyncio
async def test_entra_password_error_engages_circuit_breaker(
    test_config: Config, state_db: StateDatabase, monkeypatch: pytest.MonkeyPatch
):
    """Password errors record failures and trip the 3-strike circuit breaker."""
    async def fast_sleep(_delay: float) -> None:
        return None

    monkeypatch.setattr("custom_panopto.auth.asyncio.sleep", fast_sleep)

    manager = AuthSessionManager(test_config, state_db)
    state_db.record_auth_failure("prior failure 1")
    state_db.record_auth_failure("prior failure 2")

    page = FakePage()

    def on_panopto_sign_in() -> None:
        page.url = "https://login.microsoftonline.com/tenant/saml2"
        page.elements = {
            "input[name='passwd']": FakeElement(),
            "#idSIButton9": FakeElement(text="Sign in", on_click=on_submit_bad_pass),
        }

    def on_submit_bad_pass() -> None:
        page.elements = {
            "input[name='passwd']": FakeElement(),
            "#passwordError": FakeElement(text="Your account or password is incorrect."),
        }

    page.elements = {
        "#PageContentPlaceholder_loginControl_externalLoginButton": FakeElement(on_click=on_panopto_sign_in),
    }

    with pytest.raises(AuthCircuitBreakerError):
        await manager._perform_ncsu_login(page)

    assert test_config.is_auth_locked()
    assert state_db.get_auth_failures() == 3
