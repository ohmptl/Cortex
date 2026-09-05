import asyncio
import json

from custom_panopto.config import get_config
from custom_panopto.state import StateDatabase
from custom_panopto.auth import AuthSessionManager
from custom_panopto.panopto import PanoptoClient

folders = [
    ("ECE 463/563", "f0f2c21f-3fe0-432b-be56-b4a3005a4f59"),
    ("ECE 464/564", "0d1b21d3-cb6b-4df0-b837-b4a3005aae64"),
    ("ECE 484",     "c3ae0135-da2e-4655-b8b2-b4a3005c8ccc"),
]

async def main():
    config = get_config()
    state_db = StateDatabase(config.state_db)
    auth_mgr = AuthSessionManager(config, state_db)

    print("Authenticating session...")
    cookies = await auth_mgr.get_authenticated_cookies()
    print(f"Authenticated! ({len(cookies)} cookies)")

    client = PanoptoClient(config.panopto_base_url, cookies=cookies)

    for name, fid in folders:
        print(f"\n==========================================")
        print(f"Checking {name} (Folder ID: {fid})")
        sessions = await client.list_folder_sessions(fid)
        print(f"Total sessions discovered: {len(sessions)}")
        for s in sessions[:5]:
            print(f"  - Session ID: {s.session_id}")
            print(f"    Title: {s.title}")
            print(f"    Duration: {s.duration_seconds}s | Recorded: {s.recorded_at}")
            print(f"    Viewer: {s.viewer_url}")

            # Check transcript
            transcript = await client.get_transcript(s.session_id)
            if transcript:
                print(f"    Transcript: [READY] format={transcript.format} hash={transcript.content_hash[:12]} len={len(transcript.content)}")
                # Show first few lines
                preview = "\n      ".join(transcript.content.split("\n")[:4])
                print(f"      {preview}")
            else:
                print(f"    Transcript: [PENDING / NOT READY]")

if __name__ == "__main__":
    asyncio.run(main())
