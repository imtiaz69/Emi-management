import hashlib
import hmac
import os
from urllib.parse import urlparse

from fastapi import Header, HTTPException


def require_service_key(x_identity_service_key: str = Header(default="")) -> None:
    expected = os.getenv("IDENTITY_AI_SERVICE_KEY", "")
    if not expected or not hmac.compare_digest(x_identity_service_key.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid identity service key")


def validate_asset_url(url: str) -> str:
    parsed = urlparse(url)
    allowed = {item.strip().lower() for item in os.getenv(
        "IDENTITY_ALLOWED_ASSET_HOSTS", "res.cloudinary.com,api.cloudinary.com"
    ).split(",") if item.strip()}
    hostname = (parsed.hostname or "").lower()
    local_http = hostname in {"localhost", "127.0.0.1", "host.docker.internal"}
    if (parsed.scheme != "https" and not (parsed.scheme == "http" and local_http)) or hostname not in allowed:
        raise ValueError("Asset URL host is not allowed")
    return url


def safe_session_reference(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:12]
