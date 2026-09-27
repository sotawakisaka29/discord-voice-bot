#!/usr/bin/env bash
set -euo pipefail

BOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STYLE_BERT_VITS2_DIR="${STYLE_BERT_VITS2_DIR:-$HOME/Desktop/開発/Style-Bert-VITS2}"
STYLE_BERT_VITS2_PYTHON="${STYLE_BERT_VITS2_PYTHON:-$HOME/miniforge3-arm64/envs/StyleBertVITS2/bin/python}"
STYLE_BERT_VITS2_MODEL_DIR="${STYLE_BERT_VITS2_MODEL_DIR:-$STYLE_BERT_VITS2_DIR/model_assets/discord_voice}"
STYLE_BERT_VITS2_MODEL_FILE="${STYLE_BERT_VITS2_MODEL_FILE:-discord_voice_e50_s1326.safetensors}"
STYLE_BERT_VITS2_DEVICE="${STYLE_BERT_VITS2_DEVICE:-cpu}"

if [[ ! -x "$STYLE_BERT_VITS2_PYTHON" ]]; then
  echo "Style-Bert-VITS2 Python was not found: $STYLE_BERT_VITS2_PYTHON" >&2
  echo "Set STYLE_BERT_VITS2_DIR or STYLE_BERT_VITS2_PYTHON to your local installation." >&2
  exit 1
fi

export PYTORCH_ENABLE_MPS_FALLBACK=1

exec "$STYLE_BERT_VITS2_PYTHON" "$BOT_DIR/scripts/style_bert_vits2_server.py" \
  --style-bert-dir "$STYLE_BERT_VITS2_DIR" \
  --model-dir "$STYLE_BERT_VITS2_MODEL_DIR" \
  --model-file "$STYLE_BERT_VITS2_MODEL_FILE" \
  --device "$STYLE_BERT_VITS2_DEVICE" \
  --host 127.0.0.1 \
  --port 5000
