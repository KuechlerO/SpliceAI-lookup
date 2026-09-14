"""Gunicorn entrypoint (server:app) for Docker and bind-mounted deployments.

The Flask app implementation lives in original_flask_app/server.py after the
upstream repo reorganization. Static UI files (index.html, index.js, index.css)
remain at the repository root, so APP_ROOT is set accordingly.

Also registers same-origin reverse proxies for GeneBe / Ensembl / VariantValidator.
Outbound calls use urllib (honours HTTP(S)_PROXY), which nginx does not.
"""
import importlib.util
import json
import os
import sys
import urllib.error
import urllib.request

from flask import Response, request

_REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
_SERVER_PATH = os.path.join(_REPO_ROOT, "original_flask_app", "server.py")

_spec = importlib.util.spec_from_file_location("spliceai_lookup_server", _SERVER_PATH)
if _spec is None or _spec.loader is None:
    raise ImportError(f"Unable to load Flask app from {_SERVER_PATH}")

_server = importlib.util.module_from_spec(_spec)
sys.modules["spliceai_lookup_server"] = _server
_spec.loader.exec_module(_server)

_server.APP_ROOT = _REPO_ROOT
app = _server.app

# Browser hits /spliceai-lookup/<name>/… via nginx; Flask sees /<name>/…
_EXTERNAL_API_UPSTREAMS = {
    "genebe": "https://api.genebe.net/cloud/api-public/v1/",
    "ensembl": "https://rest.ensembl.org/",
    "ensembl-grch37": "https://grch37.rest.ensembl.org/",
    "variantvalidator": "https://rest.variantvalidator.org/",
}

_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "content-encoding",
    "content-length",
}


def _proxy_external_api(upstream_base, path):
    """Forward GET to an external HTTPS API; urllib respects HTTP(S)_PROXY."""
    url = upstream_base + path
    if request.query_string:
        url = f"{url}?{request.query_string.decode('latin-1')}"

    headers = {
        "Accept": request.headers.get("Accept", "*/*"),
        "User-Agent": request.headers.get("User-Agent", "SpliceAI-lookup-proxy/1.0"),
    }
    # Do not forward browser Origin/Referer/Cookie — those break upstream APIs / CORS checks.
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=90) as upstream:
            body = upstream.read()
            status = upstream.getcode()
            resp_headers = {
                k: v
                for k, v in upstream.headers.items()
                if k.lower() not in _HOP_BY_HOP
            }
            return Response(body, status=status, headers=resp_headers)
    except urllib.error.HTTPError as e:
        body = e.read()
        resp_headers = {
            k: v for k, v in (e.headers.items() if e.headers else []) if k.lower() not in _HOP_BY_HOP
        }
        return Response(body, status=e.code, headers=resp_headers)
    except Exception as e:
        return Response(
            json.dumps({"ok": False, "error": f"Upstream proxy failed: {e}", "url": url}),
            status=502,
            mimetype="application/json",
        )


def _register_external_api_proxies():
    for name, base in _EXTERNAL_API_UPSTREAMS.items():

        def make_view(upstream_base, route_name):
            def view(path):
                return _proxy_external_api(upstream_base, path)

            view.__name__ = f"proxy_{route_name}"
            return view

        app.add_url_rule(
            f"/{name}/<path:path>",
            endpoint=f"proxy_{name}",
            view_func=make_view(base, name),
            methods=["GET"],
        )


_register_external_api_proxies()
