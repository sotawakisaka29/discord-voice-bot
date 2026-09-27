#!/usr/bin/env python3
"""A local-only HTTP bridge for a Style-Bert-VITS2 model."""

from __future__ import annotations

import argparse
import io
import os
import sys
import threading
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve one Style-Bert-VITS2 model locally.")
    parser.add_argument("--style-bert-dir", required=True, help="Local Style-Bert-VITS2 checkout")
    parser.add_argument("--model-dir", required=True, help="Directory containing config.json and style_vectors.npy")
    parser.add_argument("--model-file", required=True, help="Safetensors filename inside --model-dir")
    parser.add_argument("--device", default="mps", choices=["mps", "cpu", "cuda"])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=5000, type=int)
    return parser.parse_args()


args = parse_args()
style_bert_dir = Path(args.style_bert_dir).expanduser().resolve()
model_dir = Path(args.model_dir).expanduser().resolve()
model_path = model_dir / args.model_file

for required_path in (style_bert_dir, model_dir, model_path, model_dir / "config.json", model_dir / "style_vectors.npy"):
    if not required_path.exists():
        raise FileNotFoundError(f"Required file or directory was not found: {required_path}")

os.chdir(style_bert_dir)
sys.path.insert(0, str(style_bert_dir))

# Style-Bert-VITS2 uses a few operations that are not yet implemented on MPS.
# Keep the model on Apple Silicon's GPU and run only those operations on CPU.
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

import torch
import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response
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

pyopenjtalk_worker.initialize_worker()
model = TTSModel(
    model_path=model_path,
    config_path=model_dir / "config.json",
    style_vec_path=model_dir / "style_vectors.npy",
    device=device,
)
generation_lock = threading.Lock()

app = FastAPI(title="Local Style-Bert-VITS2 bridge", docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "device": device, "model": model_path.name}


@app.get("/tts")
def tts(text: str = Query(min_length=1, max_length=500)) -> Response:
    try:
        with generation_lock:
            sample_rate, audio = model.infer(text=text, language=Languages.JP, style="Neutral")
        buffer = io.BytesIO()
        write(buffer, sample_rate, audio)
        return Response(buffer.getvalue(), media_type="audio/wav")
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Speech generation failed: {error}") from error


if __name__ == "__main__":
    print(f"Style-Bert-VITS2 server: http://{args.host}:{args.port} ({device})")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
