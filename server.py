"""Gunicorn entrypoint (server:app) for Docker and bind-mounted deployments.

The Flask app implementation lives in original_flask_app/server.py after the
upstream repo reorganization. Static UI files (index.html, index.js, index.css)
remain at the repository root, so APP_ROOT is set accordingly.
"""
import importlib.util
import os
import sys

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
