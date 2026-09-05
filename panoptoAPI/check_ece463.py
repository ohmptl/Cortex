import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir='/var/lib/custom-panopto/browser',
            headless=True,
            args=['--no-sandbox']
        )
        page = await ctx.new_page()

        # Listen to requests
        page.on("request", lambda req: print("REQ:", req.method, req.url) if "Data.svc" in req.url or "api/v1" in req.url else None)
        page.on("response", lambda res: print("RES:", res.status, res.url) if "Data.svc" in res.url or "api/v1" in res.url else None)

        url = 'https://ncsu.hosted.panopto.com/Panopto/Pages/Sessions/List.aspx#folderID=%22f0f2c21f-3fe0-432b-be56-b4a3005a4f59%22'
        print('Navigating to:', url)
        await page.goto(url)
        await page.wait_for_timeout(8000)

        # Inspect page title and any folder or session names on screen
        print('Page title:', await page.title())
        header = page.locator('#folderHeader, .folder-title, h1, #contentHeaderText')
        if await header.count() > 0:
            print('Header text:', await header.first.text_content())

        # Check rows or session titles on page
        rows = page.locator('.list-item, .session-row, tr.session-row, .table-row')
        print('Found session rows count:', await rows.count())

        # Check subfolders if any
        subfolders = page.locator('.folder-item, a[href*="folderID"]')
        print('Found subfolder links count:', await subfolders.count())
        for i in range(min(await subfolders.count(), 10)):
            print('  Subfolder link:', await subfolders.nth(i).get_attribute('href'), await subfolders.nth(i).text_content())

        await ctx.close()

if __name__ == '__main__':
    asyncio.run(main())
