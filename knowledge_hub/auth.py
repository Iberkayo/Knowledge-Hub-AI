"""Optional Bearer-token authentication middleware for remote/mobile access (Tailscale / iOS)."""
from __future__ import annotations

import hmac
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

_PUBLIC_API_PATHS = frozenset({"/api/health"})


def _is_media_stream_path(path: str) -> bool:
    """Allow ?token= query auth ONLY on GET audio/download endpoints where HTML <audio> cannot set headers."""
    return (
        (path.startswith("/api/items/") and (path.endswith("/audio") or path.endswith("/export")))
        or path.startswith("/api/audio-samples/")
        or path == "/api/backup"
    )


class ApiTokenMiddleware(BaseHTTPMiddleware):
    """Protect /api/* routes with a constant-time Bearer token when KH_API_TOKEN is configured."""

    def __init__(self, app, token: str):
        super().__init__(app)
        self._token = token.encode("utf-8")

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/") or path in _PUBLIC_API_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        supplied = ""
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            supplied = auth_header[7:].strip()
        elif request.method == "GET" and _is_media_stream_path(path):
            supplied = request.query_params.get("token", "").strip()

        if not supplied or not hmac.compare_digest(supplied.encode("utf-8"), self._token):
            return JSONResponse(
                status_code=401,
                content={"detail": "Yetkisiz erişim. Geçerli bir API erişim belirteci (KH_API_TOKEN) gereklidir."},
                headers={"WWW-Authenticate": "Bearer"},
            )
        return await call_next(request)
