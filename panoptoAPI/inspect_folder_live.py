import asyncio
import json
from playwright.async_api import async_playwright
from custom_panopto.config import get_config
from custom_panopto.state import StateDatabase
from custom_panopto.auth import AuthSessionManager

async def main():
    config = get_config()
    state_db = StateDatabase(config.state_db)
    auth_mgr = AuthSessionManager(config, state_db)

    # Ensure authenticated first
    await auth_mgr.get_authenticated_cookies()

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir=str(config.browser_profile_dir),
            headless=True,
            args=['--no-sandbox']
        )
        page = await ctx.new_page()

        def on_req(req):
            if "GetSessions" in req.url or "GetFolder" in req.url:
                print(f">> REQ: {req.url} | PostData: {req.post_data}")

        async def on_res(res):
            if "GetSessions" in res.url or "GetFolder" in res.url:
                try:
                    text = await res.text()
                    print(f"<< RES: {res.status} {res.url} | Body snippet: {text[:200]}")
                except Exception:
                    pass

        page.on("request", on_req)
        page.on("response", on_res)

        folder_url = 'https://ncsu.hosted.panopto.com/Panopto/Pages/Sessions/List.aspx#folderID=%22f0f2c21f-3fe0-432b-be56-b4a3005a4f59%22'
        print(f"Navigating to folder: {folder_url}")
        await page.goto(folder_url)
        await page.wait_for_timeout(6000)

        print("Page Title:", await page.title())

        # Check folder header
        h = page.locator("#contentHeaderText, .folder-title, h1")
        for i in range(await h.count()):
            txt = (await h.nth(i).text_content() or '').strip()
            if txt:
                print(f"Header [{i}]: {txt}")

        # Check subfolders or sessions
        items = page.locator(".list-item, .session-row, .table-row, a[href*='Viewer.aspx'], a[href*='folderID']")
        print(f"Found {await items.count()} items on page")
        for i in range(min(await items.count(), 10)):
            txt = (await items.nth(i).text_content() or '').strip()
            href = await items.nth(i).get_attribute("href")
            print(f"  Item [{i}] href={href} text={txt[:40]}")

        await ctx.close()

if __name__ == '__main__':
    asyncio.run(main())
