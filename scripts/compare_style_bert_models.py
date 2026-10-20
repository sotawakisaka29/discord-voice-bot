#!/usr/bin/env python3
"""Generate the same Japanese phrase with every checkpoint in one model folder."""

from __future__ import annotations

import argparse
import gc
import os
import re
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate checkpoint comparison audio.")
    parser.add_argument("--style-bert-dir", required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--device", default="cpu", choices=["cpu", "mps", "cuda"])
    return parser.parse_args()


def checkpoint_sort_key(path: Path) -> tuple[int, str]:
    match = re.search(r"_s(\d+)", path.stem)
    return (int(match.group(1)) if match else sys.maxsize, path.name)


args = parse_args()
style_bert_dir = Path(args.style_bert_dir).expanduser().resolve()
model_dir = Path(args.model_dir).expanduser().resolve()
output_dir = Path(args.output_dir).expanduser().resolve()

if not style_bert_dir.is_dir():
    raise FileNotFoundError(f"Style-Bert-VITS2 directory was not found: {style_bert_dir}")
if not model_dir.is_dir():
    raise FileNotFoundError(f"Model directory was not found: {model_dir}")
if not args.text.strip():
    raise ValueError("Comparison text must not be empty")

config_path = model_dir / "config.json"
style_vectors_path = model_dir / "style_vectors.npy"
for required_path in (config_path, style_vectors_path):
    if not required_path.is_file():
        raise FileNotFoundError(f"Required model file was not found: {required_path}")

checkpoints = sorted(model_dir.glob("*.safetensors"), key=checkpoint_sort_key)
if not checkpoints:
    raise FileNotFoundError(f"No safetensors checkpoints were found: {model_dir}")

os.chdir(style_bert_dir)
sys.path.insert(0, str(style_bert_dir))
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

import torch
from scipy.io.wavfile import write

from style_bert_vits2.constants import Languages
from style_bert_vits2.nlp.japanese import pyopenjtalk_worker
from style_bert_vits2.tts_model import TTSModel


device = args.device
if device == "mps" and not torch.backends.mps.is_available():
    print("MPS is unavailable; falling back to CPU.", file=sys.stderr)
    device = "cpu"
if device == "cuda" and not torch.cuda.is_available():
    print("CUDA is unavailable; falling back to CPU.", file=sys.stderr)
    device = "cpu"

output_dir.mkdir(parents=True, exist_ok=False)
pyopenjtalk_worker.initialize_worker()

for index, checkpoint in enumerate(checkpoints, start=1):
    print(f"[{index}/{len(checkpoints)}] {checkpoint.name}", flush=True)
    model = TTSModel(
        model_path=checkpoint,
        config_path=config_path,
        style_vec_path=style_vectors_path,
        device=device,
    )
    sample_rate, audio = model.infer(
        text=args.text.strip(),
        language=Languages.JP,
        style="Neutral",
    )
    write(output_dir / f"{checkpoint.stem}.wav", sample_rate, audio)
    del model
    gc.collect()
    if device == "mps" and torch.backends.mps.is_available():
        torch.mps.empty_cache()
    elif device == "cuda" and torch.cuda.is_available():
        torch.cuda.empty_cache()

print(f"Generated {len(checkpoints)} comparison files in {output_dir}", flush=True)
