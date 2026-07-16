"""Boss OS core — client "người đi mua" của Cửa hàng Premium.

KHÔNG chứa code premium. Chỉ: hỏi danh mục, tạo đơn, poll license, verify license
offline bằng public key nhúng sẵn, và tải/cài pack (đã verify chữ ký) vào
<brain>/.claude/skills/<pack_id>/ để Boss OS nạp như một skill thường.

Store server (của Sếp) trỏ qua env BOSS_STORE_URL.
"""
import base64
import io
import json
import os
import secrets
import shutil
import tempfile
import time
import zipfile
from pathlib import Path

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import APIRouter, HTTPException, Request

from config import STATE_DIR

STORE_URL = os.getenv("BOSS_STORE_URL", "http://127.0.0.1:8899").rstrip("/")

# Public key nhúng sẵn — AN TOÀN để công khai (chỉ verify, không ký được).
# Đổi qua env BOSS_STORE_PUBKEY nếu xoay khoá.
_PUBKEY_B64 = os.getenv(
    "BOSS_STORE_PUBKEY", "R7IjKMZhIjm__ajDqASIreEx8cufnySUxzloT4eX9O4"
)

INSTANCE_PATH = STATE_DIR / ".instance_id"
LICENSES_PATH = STATE_DIR / "premium_licenses.json"
REGISTRY_PATH = STATE_DIR / "premium_installed.json"

# main.py gọi set_brain_resolver(_brain_root) sau khi import (tránh vòng import).
_brain_root_fn = None


def set_brain_resolver(fn):
    global _brain_root_fn
    _brain_root_fn = fn


# ---------- crypto ----------
def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _pubkey() -> Ed25519PublicKey:
    return Ed25519PublicKey.from_public_bytes(_b64d(_PUBKEY_B64))


def verify_license(token: str):
    """Trả payload dict nếu chữ ký license hợp lệ, None nếu sai."""
    try:
        payload_b64, sig_b64 = token.split(".")
        _pubkey().verify(_b64d(sig_b64), payload_b64.encode())
        return json.loads(_b64d(payload_b64))
    except Exception:
        return None


def verify_pack(data: bytes, sig_b64: str) -> bool:
    try:
        _pubkey().verify(_b64d(sig_b64), data)
        return True
    except Exception:
        return False


# ---------- state ----------
def instance_id() -> str:
    if INSTANCE_PATH.exists():
        return INSTANCE_PATH.read_text().strip()
    iid = "inst-" + secrets.token_hex(8)
    INSTANCE_PATH.write_text(iid)
    return iid


def _load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            return default
    return default


def _save_json(path: Path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2))


def load_licenses() -> dict:
    """{pack_id: {token, version, buyer, license_id}}"""
    return _load_json(LICENSES_PATH, {})


def store_license(token: str):
    payload = verify_license(token)
    if not payload:
        return None
    lics = load_licenses()
    lics[payload["pack_id"]] = {
        "token": token,
        "version": payload.get("version"),
        "buyer": payload.get("buyer"),
        "license_id": payload.get("license_id"),
    }
    _save_json(LICENSES_PATH, lics)
    return payload


def installed_registry() -> dict:
    return _load_json(REGISTRY_PATH, {})


def _skills_root(brain: str) -> Path:
    root = Path(_brain_root_fn(brain)) if _brain_root_fn else STATE_DIR
    d = root / ".claude" / "skills"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---------- store API (proxy) ----------
async def fetch_packs() -> dict:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{STORE_URL}/v1/packs")
        r.raise_for_status()
        return r.json()


async def create_checkout(pack_id: str, version: str, buyer: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"{STORE_URL}/v1/checkout",
            json={
                "pack_id": pack_id,
                "version": version,
                "buyer": buyer,
                "instance_id": instance_id(),
            },
        )
        if r.status_code != 200:
            raise HTTPException(r.status_code, r.text)
        return r.json()


async def poll_order(order_id: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{STORE_URL}/v1/license", params={"order_id": order_id})
        data = r.json()
    if data.get("status") == "paid" and data.get("license"):
        store_license(data["license"])
    return data


async def install_pack(pack_id: str, brain: str = "") -> dict:
    lics = load_licenses()
    lic = lics.get(pack_id)
    if not lic:
        raise HTTPException(403, "Chưa có license cho pack này")
    payload = verify_license(lic["token"])
    if not payload:
        raise HTTPException(403, "License hỏng")
    version = payload["version"]

    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.get(
            f"{STORE_URL}/v1/download/{pack_id}/{version}",
            params={"license": lic["token"]},
        )
        if r.status_code != 200:
            raise HTTPException(r.status_code, "Tải pack lỗi")
        data = r.content
        sig = r.headers.get("X-Pack-Signature", "")

    if not verify_pack(data, sig):
        raise HTTPException(400, "Chữ ký pack sai — từ chối cài")

    root = Path(_brain_root_fn(brain)) if _brain_root_fn else STATE_DIR
    skills_root = root / ".claude" / "skills"
    agents_root = root / "agents"
    workflows_root = root / "workflows"

    installed_paths = []
    with tempfile.TemporaryDirectory() as tmp:
        tmpd = Path(tmp)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            z.extractall(tmpd)
        manifest = json.loads((tmpd / "manifest.json").read_text())
        slug = manifest["pack_id"]
        wm = (tmpd / ".watermark").read_text() if (tmpd / ".watermark").exists() else ""

        def _install_children(src_parent, dest_root):
            """Cài từng mục con của src_parent vào dest_root (ghi đè nếu trùng tên)."""
            if not src_parent.is_dir():
                return
            dest_root.mkdir(parents=True, exist_ok=True)
            for item in sorted(src_parent.iterdir()):
                dest = dest_root / item.name
                if dest.exists():
                    shutil.rmtree(dest) if dest.is_dir() else dest.unlink()
                if item.is_dir():
                    shutil.copytree(item, dest)
                    if wm:
                        (dest / ".premium").write_text(wm)
                else:
                    shutil.copy2(item, dest)
                installed_paths.append(str(dest.relative_to(root)))

        # Bó đa thành phần
        _install_children(tmpd / "skills", skills_root)
        _install_children(tmpd / "agents", agents_root)
        _install_children(tmpd / "workflows", workflows_root)

        # Tương thích pack cũ: skill/ (số ít) -> .claude/skills/<pack_id>/
        legacy = tmpd / "skill"
        if legacy.is_dir():
            dest = skills_root / slug
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(legacy, dest)
            if wm:
                (dest / ".premium").write_text(wm)
            installed_paths.append(str(dest.relative_to(root)))

    if not installed_paths:
        raise HTTPException(400, "Pack không có thành phần cài được (skills/agents/workflows)")

    reg = installed_registry()
    reg[slug] = {
        "version": manifest["version"],
        "name": manifest.get("name"),
        "installed_at": int(time.time()),
        "paths": installed_paths,
        "watermark": json.loads(wm) if wm else {},
    }
    _save_json(REGISTRY_PATH, reg)
    return {"ok": True, "pack_id": slug, "version": manifest["version"], "components": len(installed_paths)}


# ---------- routes ----------
router = APIRouter(prefix="/store", tags=["store"])


@router.get("/status")
def status():
    lics = load_licenses()
    return {
        "instance_id": instance_id(),
        "store_url": STORE_URL,
        "licenses": {k: {kk: vv for kk, vv in v.items() if kk != "token"} for k, v in lics.items()},
        "installed": installed_registry(),
    }


@router.get("/packs")
async def packs():
    try:
        return await fetch_packs()
    except Exception as e:
        raise HTTPException(502, f"Không kết nối được Store: {e}")


@router.post("/checkout")
async def checkout(req: Request):
    body = await req.json()
    return await create_checkout(
        body.get("pack_id"), body.get("version"), (body.get("buyer") or "").strip()
    )


@router.get("/poll")
async def poll(order_id: str):
    return await poll_order(order_id)


@router.post("/license")
async def add_license(req: Request):
    body = await req.json()
    payload = store_license((body.get("license") or "").strip())
    if not payload:
        raise HTTPException(400, "License không hợp lệ")
    return {"ok": True, "pack_id": payload["pack_id"], "version": payload["version"]}


@router.post("/install")
async def install(req: Request):
    body = await req.json()
    return await install_pack(body.get("pack_id"), body.get("brain") or "")
