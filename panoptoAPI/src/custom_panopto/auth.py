"""Simplified, robust NC State Shibboleth & Duo authentication manager using Playwright."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional
from playwright.async_api import async_playwright, BrowserContext, Page

from .config import Config
from .state import StateDatabase

logger = logging.getLogger("custom_panopto.auth")


class AuthError(Exception):
    """Base exception for authentication errors."""


class AuthCircuitBreakerError(AuthError):
    """Raised when the 3-strike circuit breaker is active to prevent account lockout."""


class AuthSessionManager:
    """Manages persistent browser sessions, automated NC State login, and cookie extraction."""

    def __init__(self, config: Config, state_db: StateDatabase) -> None:
        self.config = config
        self.state_db = state_db

    async def get_authenticated_cookies(self) -> dict[str, str]:
        """Verify existing session or perform automated login and return authenticated cookies."""
        if self.config.is_auth_locked():
            raise AuthCircuitBreakerError(
                f"Emergency circuit breaker is active ({self.config.circuit_breaker_file}). "
                "Halting to prevent NC State Unity account lockout. Resolve credentials and remove lock file to resume."
            )

        self.config.ensure_directories()
        headless = self.config.browser_mode.lower() != "xvfb" and self.config.browser_mode.lower() != "headed"

        async with async_playwright() as p:
            # Launch persistent browser context
            context = await p.chromium.launch_persistent_context(
                user_data_dir=str(self.config.browser_profile_dir),
                headless=headless,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-blink-features=AutomationControlled",
                ],
                viewport={"width": 1280, "height": 800},
                user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            )
            try:
                page = await context.new_page()

                # Step 1: Quick check if existing session is already valid
                logger.info("Checking if existing Panopto session is valid...")
                is_valid = await self._check_existing_session(page)
                if is_valid:
                    logger.info("Existing Panopto session is active and valid.")
                    self.state_db.reset_auth_failures()
                    return await self._extract_cookies(context)

                # Step 2: Session expired or first run -> Perform automated NC State login
                logger.info("Session invalid or expired. Performing automated NC State authentication...")
                await self._perform_ncsu_login(page)

                # Step 3: Validate successful login
                if not await self._is_on_panopto(page):
                    raise AuthError(f"Authentication ended on unexpected page: {page.url}")

                logger.info("Authentication succeeded. Resetting failure counters.")
                self.state_db.reset_auth_failures()
                return await self._extract_cookies(context)

            finally:
                await context.close()

    async def _check_existing_session(self, page: Page) -> bool:
        """Test if the browser context already has an active Panopto session with valid .ASPXAUTH."""
        try:
            cookies = await page.context.cookies()
            has_auth = any(c["name"] == ".ASPXAUTH" and c.get("value") for c in cookies)
            if not has_auth:
                return False

            # Verify active session using Panopto GetSessions service
            response = await page.request.post(
                f"{self.config.panopto_base_url}/Panopto/Services/Data.svc/GetSessions",
                data='{"queryParameters":{"page":0}}',
                headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
            )
            if response.status == 200:
                data = await response.json()
                if "d" in data and "Results" in data["d"]:
                    return True
        except Exception as e:
            logger.debug("Session check error: %s", e)

        return False




    async def _perform_ncsu_login(self, page: Page) -> None:
        """Execute automated credential submission and Duo wait loop with 3-attempt circuit breaker."""
        failures = self.state_db.get_auth_failures()
        if failures >= self.config.max_auth_attempts:
            self.config.set_auth_locked(f"{failures} consecutive failed attempts recorded in state database")
            raise AuthCircuitBreakerError(
                f"Aborting: {failures} consecutive failed logins recorded. "
                "Circuit breaker engaged to protect your NC State account."
            )

        if not self.config.ncsu_username or not self.config.ncsu_password:
            raise AuthError("NCSU_USERNAME and NCSU_PASSWORD must be configured to authenticate.")

        # Navigate to login page
        login_url = f"{self.config.panopto_base_url}/Panopto/Pages/Auth/Login.aspx"
        logger.info("Navigating to %s", login_url)
        await page.goto(login_url, wait_until="networkidle", timeout=25000)

        # Click the external login button (Unity-Login is selected by default)
        sign_in_button = page.locator(
            "#PageContentPlaceholder_loginControl_externalLoginButton, a:has-text('Sign in')"
        ).first
        try:
            await sign_in_button.wait_for(state="visible", timeout=10000)
            logger.info("Clicking Sign In to redirect to NC State Shibboleth...")
            await sign_in_button.click()
            await page.wait_for_load_state("domcontentloaded", timeout=20000)
        except Exception as ex:
            logger.debug("Sign In button not clicked (might already be on SSO): %s", ex)


        # Check if already on Panopto
        if await self._is_on_panopto(page):
            logger.info("Already on Panopto without re-authenticating.")
            return

        # Check whether redirected to Microsoft Entra ID or legacy Shibboleth
        logger.info("Filling NC State Unity credentials...")
        ms_user = page.locator("input[name='loginfmt'], #i0116").first
        shib_user = page.locator("#username, input[name='j_username']").first

        try:
            await page.wait_for_selector(
                "input[name='loginfmt'], #i0116, #username, input[name='j_username']",
                timeout=20000,
            )
        except Exception:
            if await self._is_on_panopto(page):
                logger.info("Already on Panopto without re-authenticating.")
                return

        if await ms_user.count() > 0 and await ms_user.is_visible():
            logger.info("Detected Microsoft Entra ID login flow...")
            raw_user = self.config.ncsu_username.strip()
            email = raw_user if "@" in raw_user else f"{raw_user}@ncsu.edu"

            await ms_user.fill(email)
            await page.locator("#idSIButton9, input[type='submit']").first.click()

            ms_pass = page.locator("input[name='passwd'], #i0118").first
            await ms_pass.wait_for(state="visible", timeout=20000)
            await ms_pass.fill(self.config.ncsu_password)

            submit_btn = page.locator("#idSIButton9, input[type='submit']").first
            await submit_btn.click()

            await asyncio.sleep(2.5)

            # Check for Microsoft credential error
            ms_error = page.locator("#passwordError, #usernameError, .error").first
            if await ms_error.count() > 0 and await ms_error.is_visible():
                err_text = await ms_error.inner_text()
                new_failures = self.state_db.record_auth_failure(f"Microsoft login error: {err_text}")
                if new_failures >= self.config.max_auth_attempts:
                    self.config.set_auth_locked("Invalid credentials submitted 3 times consecutively")
                    raise AuthCircuitBreakerError("Invalid credentials (3 strikes). Emergency circuit breaker engaged.")
                raise AuthError(f"NC State login rejected credentials (attempt {new_failures}/{self.config.max_auth_attempts}): {err_text}")

        else:
            logger.info("Detected Shibboleth login flow...")
            pass_input = page.locator("#password, input[name='j_password']").first
            await shib_user.wait_for(state="visible", timeout=20000)
            await shib_user.fill(self.config.ncsu_username)
            await pass_input.fill(self.config.ncsu_password)

            submit_btn = page.locator("#formSubmit, button[type='submit'], input[type='submit']").first
            if await submit_btn.count() > 0:
                await submit_btn.click()
            else:
                await pass_input.press("Enter")

            await asyncio.sleep(2.5)

            # Check for immediate credential failure
            body_text = await page.inner_text("body")
            if (
                "The username or password you entered was incorrect" in body_text
                or "Invalid username or password" in body_text
                or "Authentication failed" in body_text
            ):
                new_failures = self.state_db.record_auth_failure("Invalid credentials submitted")
                if new_failures >= self.config.max_auth_attempts:
                    self.config.set_auth_locked("Invalid credentials submitted 3 times consecutively")
                    raise AuthCircuitBreakerError("Invalid credentials (3 strikes). Emergency circuit breaker engaged.")
                raise AuthError(f"NC State login rejected credentials (attempt {new_failures}/{self.config.max_auth_attempts})")

        # Handle Duo screen and post-approval prompts
        logger.info("Waiting for Duo approval (external duoapprove service)...")
        await self._wait_for_duo_and_prompts(page)


    async def _wait_for_duo_and_prompts(self, page: Page) -> None:
        """Wait for external duoapprove to approve push and dismiss post-approval prompts."""
        start_time = asyncio.get_event_loop().time()
        max_time = self.config.duo_timeout_seconds

        while (asyncio.get_event_loop().time() - start_time) < max_time:
            # If successfully redirected to Panopto, we are done!
            if await self._is_on_panopto(page):
                logger.info("Successfully returned to Panopto!")
                return

            # Check for Microsoft 'Stay signed in?' prompt
            try:
                stay_btn = page.locator("#idSIButton9, input[value='Yes'], #declineButton").first
                if await stay_btn.count() > 0 and await stay_btn.is_visible():
                    logger.info("Dismissing Microsoft 'Stay signed in' prompt...")
                    await stay_btn.click()
            except Exception:
                pass

            # Check for Duo factor selection: click 'Send Me a Push' or 'Duo Push' if not automatic
            try:
                push_btn = page.locator(
                    "button:has-text('Send Me a Push'), "
                    "button:has-text('Duo Push'), "
                    "button#auth-button"
                ).first
                if await push_btn.count() > 0 and await push_btn.is_visible():
                    logger.info("Clicking 'Send Me a Push' on Duo screen...")
                    await push_btn.click()
            except Exception:
                pass

            # Check for Duo post-approval prompt: "Your app needs to be updated" -> "Skip for now"
            try:
                skip_btn = page.locator("button:has-text('Skip for now'), a:has-text('Skip for now'), button:has-text('Dismiss'), button:has-text('Later')")
                if await skip_btn.count() > 0 and await skip_btn.first.is_visible():
                    logger.info("Dismissing Duo update prompt ('Skip for now')...")
                    await skip_btn.first.click()
            except Exception:
                pass

            # Check for Duo post-approval prompt: "Is this your device?" -> "Yes, this is my device"
            try:
                trust_btn = page.locator(
                    "button#trust-browser-button, "
                    "button:has-text('Yes, this is my device'), "
                    "button:has-text('Yes, trust browser'), "
                    "button:has-text('Trust')"
                )
                if await trust_btn.count() > 0 and await trust_btn.first.is_visible():
                    logger.info("Answering Duo trust prompt ('Yes, this is my device')...")
                    await trust_btn.click()
            except Exception:
                pass

            # Check if there's an iframe containing Duo (Duo Universal or legacy frame)
            for frame in page.frames:
                try:
                    f_push = frame.locator("button:has-text('Send Me a Push'), button:has-text('Duo Push'), button#auth-button").first
                    if await f_push.count() > 0 and await f_push.is_visible():
                        await f_push.click()
                    f_skip = frame.locator("button:has-text('Skip for now'), button:has-text('Dismiss')").first
                    if await f_skip.count() > 0 and await f_skip.is_visible():
                        await f_skip.click()
                    f_trust = frame.locator("button:has-text('Yes, this is my device'), button#trust-browser-button").first
                    if await f_trust.count() > 0 and await f_trust.is_visible():
                        await f_trust.click()
                except Exception:
                    pass

            await asyncio.sleep(2.0)

        # If timeout reached and still not on Panopto
        if not await self._is_on_panopto(page):
            self.state_db.record_auth_failure("Duo approval timeout")
            raise AuthError(f"Duo approval timed out after {max_time} seconds (current URL: {page.url})")

    async def _is_on_panopto(self, page: Page) -> bool:
        url = page.url.lower()
        return (
            "panopto.com" in url
            and "shibboleth" not in url
            and "duo" not in url
            and "microsoftonline.com" not in url
        )

    async def _extract_cookies(self, context: BrowserContext) -> dict[str, str]:
        """Extract cookies from browser context into a clean name->value dictionary."""
        cookies = await context.cookies()
        return {c["name"]: c["value"] for c in cookies}
