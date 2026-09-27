#!/usr/bin/env bash
set -euo pipefail

BOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GPT_SOVITS_DIR="${GPT_SOVITS_DIR:-"$BOT_DIR/../GPT-SoVITS"}"
GPT_SOVITS_PYTHON="${GPT_SOVITS_PYTHON:-"/Users/wakisakasota/miniforge3-arm64/envs/GPTSoVits-arm64/bin/python"}"
CONFIG_PATH="$(mktemp "${TMPDIR:-/tmp}/gpt-sovits-mps.XXXXXX.yaml")"

cleanup() {
  rm -f "$CONFIG_PATH"
}
trap cleanup EXIT INT TERM

if [[ ! -x "$GPT_SOVITS_PYTHON" ]]; then
  echo "GPT-SoVITS用Pythonが見つかりません: $GPT_SOVITS_PYTHON" >&2
  exit 1
fi

if [[ ! -f "$GPT_SOVITS_DIR/api_v2.py" ]]; then
  echo "GPT-SoVITS本体が見つかりません: $GPT_SOVITS_DIR" >&2
  exit 1
fi

sed "s|__GPT_SOVITS_DIR__|$GPT_SOVITS_DIR|g" \
  "$BOT_DIR/scripts/gpt-sovits-mps.yaml.template" > "$CONFIG_PATH"

cd "$GPT_SOVITS_DIR"
"$GPT_SOVITS_PYTHON" api_v2.py --tts_config "$CONFIG_PATH" --bind_addr 127.0.0.1 --port 9881
