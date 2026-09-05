import asyncio
import json
import httpx

from custom_panopto.config import get_config
from custom_panopto.state import StateDatabase
from custom_panopto.auth import AuthSessionManager

async def main():
    config = get_config()
    state_db = StateDatabase(config.state_db)
    auth_mgr = AuthSessionManager(config, state_db)

    print("Authenticating...")
    cookies = await auth_mgr.get_authenticated_cookies()
    print(f"Got {len(cookies)} cookies. Has .ASPXAUTH: {'.ASPXAUTH' in cookies}")

    folder_id = "f0f2c21f-3fe0-432b-be56-b4a3005a4f59"

    async with httpx.AsyncClient(cookies=cookies, timeout=15.0) as client:
        # Check GetFolderInfo
        r = await client.post(
            f"{config.panopto_base_url}/Panopto/Services/Data.svc/GetFolderInfo",
            json={"folderID": folder_id},
            headers={"Content-Type": "application/json"}
        )
        print(f"GetFolderInfo status: {r.status_code}")
        folder_info = r.json().get("d", {})
        print("Folder Name:", folder_info.get("Name") or folder_info.get("FolderName"))
        print("ParentFolderID:", folder_info.get("ParentFolderID"))
        print("SubfolderCount:", folder_info.get("SubfolderCount"))
        print("SessionCount:", folder_info.get("SessionCount"))
        print("Folder details:", json.dumps(folder_info, indent=2))

        # Check GetFoldersChildren (subfolders)
        r2 = await client.post(
            f"{config.panopto_base_url}/Panopto/Services/Data.svc/GetFolders",
            json={"queryParameters": {"parentFolderID": folder_id}},
            headers={"Content-Type": "application/json"}
        )
        print(f"GetFolders status: {r2.status_code}")
        if r2.status_code == 200:
            print("GetFolders results:", json.dumps(r2.json().get("d", {}), indent=2)[:500])

if __name__ == "__main__":
    asyncio.run(main())
