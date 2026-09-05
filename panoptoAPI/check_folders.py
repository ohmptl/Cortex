import asyncio
import json
from playwright.async_api import async_playwright

folders = [
    ("ECE 463/563", "f0f2c21f-3fe0-432b-be56-b4a3005a4f59"),
    ("ECE 464/564", "0d1b21d3-cb6b-4df0-b837-b4a3005aae64"),
    ("ECE 484",     "c3ae0135-da2e-4655-b8b2-b4a3005c8ccc"),
]

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir='/var/lib/custom-panopto/browser',
            headless=True,
            args=['--no-sandbox']
        )
        page = await ctx.new_page()
        for name, fid in folders:
            payload = {'queryParameters': {'folderID': fid, 'page': 0, 'sortColumn': 1}}
            res = await page.request.post(
                'https://ncsu.hosted.panopto.com/Panopto/Services/Data.svc/GetSessions',
                data=json.dumps(payload),
                headers={'Content-Type': 'application/json'}
            )
            data = await res.json()
            results = data.get('d', {}).get('Results', [])
            print(f"=== {name} (Folder: {fid}) ===")
            print(f"Total sessions: {len(results)}")
            for s in results[:6]:
                sid = s.get('DeliveryID') or s.get('PublicID')
                sname = s.get('SessionName')
                duration = s.get('Duration')
                date = s.get('Date')
                print(f"  - [{sid}] {sname} ({duration}s, date: {date})")

                # Check if transcript is ready
                srt_res = await page.request.get(
                    f"https://ncsu.hosted.panopto.com/Panopto/Pages/Transcription/GenerateSRT.ashx?id={sid}&language=English_USA"
                )
                if srt_res.status == 200 and not srt_res.text.startswith("<!DOCTYPE"):
                    print(f"    [TRANSCRIPT AVAILABLE] length: {len(srt_res.text)} chars")
                else:
                    print(f"    [TRANSCRIPT PENDING/UNAVAILABLE] status: {srt_res.status}")

        await ctx.close()

if __name__ == '__main__':
    asyncio.run(main())
