#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "使い方: $0 入力.wav ラベル.txt 出力フォルダ" >&2
  exit 1
fi

input_wav=$1
labels_file=$2
output_dir=$3

command -v ffmpeg >/dev/null || { echo "ffmpeg が見つかりません。" >&2; exit 1; }
[ -f "$input_wav" ] || { echo "入力WAVが見つかりません: $input_wav" >&2; exit 1; }
[ -f "$labels_file" ] || { echo "ラベルファイルが見つかりません: $labels_file" >&2; exit 1; }

mkdir -p "$output_dir"

mktemp_file=$(mktemp)
trap 'rm -f "$mktemp_file"' EXIT

awk -F '\t' 'NF >= 3 && $1 ~ /^[0-9.]+$/ && $2 ~ /^[0-9.]+$/ && $2 > $1 {
  gsub(/\r/, "", $3)
  if ($3 ~ /^[0-9]+$/) print $1 "\t" $2 "\t" $3
}' "$labels_file" | sort -n -k1,1 > "$mktemp_file"

[ -s "$mktemp_file" ] || { echo "有効な範囲ラベルがありません。" >&2; exit 1; }

while IFS=$'\t' read -r start end label; do
  output_path="$output_dir/$label.wav"
  if [ -e "$output_path" ]; then
    echo "出力先が既に存在します: $output_path" >&2
    exit 1
  fi

  ffmpeg -hide_banner -loglevel error -ss "$start" -to "$end" -i "$input_wav" \
    -ac 1 -ar 44100 -c:a pcm_s16le "$output_path"
  echo "作成: $output_path"
done < "$mktemp_file"
