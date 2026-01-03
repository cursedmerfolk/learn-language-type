#!/usr/bin/env bash
set -euo pipefail
export FLASK_APP=app.app
export FLASK_ENV=development
# Use 0.0.0.0 for dev containers
flask run --host=0.0.0.0 --port=8000
