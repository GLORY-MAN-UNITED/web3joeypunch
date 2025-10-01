"""Environment configuration helpers for the RAG system."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional, Union

_ENV_LOADED = False


def load_env(path: Optional[Union[str, Path]] = None) -> None:
    """Load KEY=VALUE pairs from a .env file into ``os.environ``."""
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    candidate = Path(path) if path is not None else Path(__file__).resolve().parents[1] / ".env"
    try:
        with candidate.open("r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip()
                if not key:
                    continue
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                    value = value[1:-1]
                os.environ.setdefault(key, value)
    except FileNotFoundError:
        pass
    except OSError:
        pass
    _ENV_LOADED = True
