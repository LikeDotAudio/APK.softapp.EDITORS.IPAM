# Smoke test — EDITORS.IPAM

Is `EDITORS.IPAM` deployed? Written by `.apk.scripts/smoke.py` from the module's own shape; what each check means is in that script's header.

← [Wiki home](../README.md)

**❌ FAIL** — 2/3 checks, since 2026-11-12 00:16 EST

| Check | Target | Result | Detail |
|---|---|---|---|
| pushed | [APK.softapp.EDITORS.IPAM](https://github.com/LikeDotAudio/APK.softapp.EDITORS.IPAM.git) | ❌ | 1 commit(s) not pushed |
| web | [index.html](https://apk.audio/APK%3ASoftapps/EDITORS/EDITORS.IPAM/index.html) | ✅ | HTTP 200 |
| app | `OS/IPAM Subnets` → `PODS/POD.THIN/Softapps/EDITORS/EDITORS.IPAM/index.html` | ✅ | present |

Re-run: `python3 .apk.scripts/smoke.py PODS/POD.THIN/Softapps/EDITORS/EDITORS.IPAM`

<!-- smoke:sig b208a7153fd6 since 2026-11-12 00:16 EST -->
