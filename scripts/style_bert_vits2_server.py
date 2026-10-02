#!/usr/bin/env python3
"""A local-only HTTP bridge for multiple Style-Bert-VITS2 models."""

from __future__ import annotations

import argparse
import gc
import io
import json
import os
import sys
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve Style-Bert-VITS2 models locally.")
    parser.add_argument("--style-bert-dir", required=True)
    parser.add_argument("--models-config", required=True)
    parser.add_argument("--max-cached-models", default=2, type=int)
    parser.add_argument("--device", default="mps", choices=["mps", "cpu", "cuda"])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=5000, type=int)
    return parser.parse_args()


@dataclass(frozen=True)
class ModelDefinition:
    model_id: str
    model_dir: Path
    model_path: Path


args = parse_args()
if args.max_cached_models < 1:
    raise ValueError("--max-cached-models must be at least 1")

style_bert_dir = Path(args.style_bert_dir).expanduser().resolve()
models_config_path = Path(args.models_config).expanduser().resolve()
if not style_bert_dir.is_dir():
    raise FileNotFoundError(f"Style-Bert-VITS2 directory was not found: {style_bert_dir}")
if not models_config_path.is_file():
    raise FileNotFoundError(f"Models config was not found: {models_config_path}")

with models_config_path.open(encoding="utf-8") as config_file:
    models_config = json.load(config_file)

raw_models = models_config.get("models")
if not isinstance(raw_models, dict) or not raw_models:
    raise ValueError("Models config must contain a non-empty models object")

model_definitions: dict[str, ModelDefinition] = {}
for model_id, raw_definition in raw_models.items():
    if not isinstance(model_id, str) or not model_id:
        raise ValueError("Every model ID must be a non-empty string")
    if not isinstance(raw_definition, dict):
        raise ValueError(f"Model definition must be an object: {model_id}")

    raw_model_dir = Path(str(raw_definition.get("modelDir", ""))).expanduser()
    model_dir = raw_model_dir if raw_model_dir.is_absolute() else style_bert_dir / raw_model_dir
    model_dir = model_dir.resolve()
    model_file = raw_definition.get("modelFile")
    if not isinstance(model_file, str) or not model_file:
        raise ValueError(f"modelFile is required for model: {model_id}")
    model_path = model_dir / model_file

    for required_path in (model_dir, model_path, model_dir / "config.json", model_dir / "style_vectors.npy"):
        if not required_path.exists():
            raise FileNotFoundError(f"Required model file or directory was not found: {required_path}")

    model_definitions[model_id] = ModelDefinition(model_id, model_dir, model_path)

default_model_id = models_config.get("defaultModelId")
if default_model_id not in model_definitions:
    raise ValueError("defaultModelId must reference a configured model")

preload_model_ids = models_config.get("preloadModelIds", [])
if not isinstance(preload_model_ids, list) or any(model_id not in model_definitions for model_id in preload_model_ids):
    raise ValueError("preloadModelIds must contain only configured model IDs")
if len(preload_model_ids) > args.max_cached_models:
    raise ValueError("preloadModelIds cannot exceed --max-cached-models")

os.chdir(style_bert_dir)
sys.path.insert(0, str(style_bert_dir))
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
model_cache: OrderedDict[str, TTSModel] = OrderedDict()
generation_lock = threading.Lock()


def release_accelerator_cache() -> None:
    gc.collect()
    if device == "mps" and torch.backends.mps.is_available():
        torch.mps.empty_cache()
    elif device == "cuda" and torch.cuda.is_available():
        torch.cuda.empty_cache()


def load_model(model_id: str) -> TTSModel:
    cached_model = model_cache.pop(model_id, None)
    if cached_model is not None:
        model_cache[model_id] = cached_model
        return cached_model

    definition = model_definitions.get(model_id)
    if definition is None:
        raise KeyError(model_id)

    while len(model_cache) >= args.max_cached_models:
        evicted_id, evicted_model = model_cache.popitem(last=False)
        del evicted_model
        release_accelerator_cache()
        print(f"Unloaded Style-Bert-VITS2 model: {evicted_id}")

    loaded_model = TTSModel(
        model_path=definition.model_path,
        config_path=definition.model_dir / "config.json",
        style_vec_path=definition.model_dir / "style_vectors.npy",
        device=device,
    )
    model_cache[model_id] = loaded_model
    print(f"Loaded Style-Bert-VITS2 model: {model_id} ({definition.model_path.name})")
    return loaded_model


for preload_model_id in preload_model_ids:
    load_model(preload_model_id)

app = FastAPI(title="Local Style-Bert-VITS2 bridge", docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "device": device,
        "availableModels": list(model_definitions),
        "cachedModels": list(model_cache),
        "maxCachedModels": args.max_cached_models,
    }


@app.get("/tts")
def tts(
    text: str = Query(min_length=1, max_length=500),
    model: str = Query(default=default_model_id, min_length=1),
) -> Response:
    if model not in model_definitions:
        raise HTTPException(status_code=404, detail=f"Unknown model: {model}")

    try:
        with generation_lock:
            selected_model = load_model(model)
            sample_rate, audio = selected_model.infer(text=text, language=Languages.JP, style="Neutral")
        buffer = io.BytesIO()
        write(buffer, sample_rate, audio)
        return Response(buffer.getvalue(), media_type="audio/wav")
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Speech generation failed: {error}") from error


if __name__ == "__main__":
    print(f"Style-Bert-VITS2 server: http://{args.host}:{args.port} ({device})")
    print(f"Available models: {', '.join(model_definitions)}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
