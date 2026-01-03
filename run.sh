#!/usr/bin/env bash
set -euo pipefail
export FLASK_APP=app.app
export FLASK_ENV=development
# Use 0.0.0.0 for dev containers

VENV_PY="/workspace/code_typing/.venv/bin/python"
if [[ -x "$VENV_PY" ]]; then
	"$VENV_PY" -m flask run --host=0.0.0.0 --port=8000
else
	flask run --host=0.0.0.0 --port=8000
fi
