#!/usr/bin/env bash
set -euo pipefail

# Run awesome-align on a prepared `sp_en.txt`.
#
# Usage:
#   ./tools/run_awesome_align.sh sp_en.txt output-aligned.txt
#
# Or via env vars:
#   DATA_FILE=sp_en.txt OUTPUT_FILE=output-aligned.txt ./tools/run_awesome_align.sh

DATA_FILE="${1:-${DATA_FILE:-sp_en.txt}}"
OUTPUT_FILE="${2:-${OUTPUT_FILE:-output-aligned.txt}}"
MODEL_NAME_OR_PATH="${MODEL_NAME_OR_PATH:-bert-base-multilingual-cased}"
EXTRACTION="${EXTRACTION:-softmax}"
BATCH_SIZE="${BATCH_SIZE:-32}"

if [[ ! -f "$DATA_FILE" ]]; then
  echo "Data file not found: $DATA_FILE" >&2
  exit 1
fi

# Expect `awesome-align` on PATH (e.g. pip install awesome-align)
command -v awesome-align >/dev/null 2>&1 || {
  echo "awesome-align not found on PATH. Install it first: pip install awesome-align" >&2
  exit 1
}

echo "Running awesome-align…"
echo "  data:   $DATA_FILE"
echo "  output: $OUTPUT_FILE"

awesome-align \
  --data_file="$DATA_FILE" \
  --output_file="$OUTPUT_FILE" \
  --model_name_or_path="$MODEL_NAME_OR_PATH" \
  --extraction "$EXTRACTION" \
  --batch_size "$BATCH_SIZE"

echo "Done: $OUTPUT_FILE"
