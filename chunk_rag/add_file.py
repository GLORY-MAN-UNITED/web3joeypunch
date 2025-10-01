"""CLI utility to append a QA pair as a document under the data directory."""

from __future__ import annotations

import argparse
from datetime import datetime
import re
from pathlib import Path


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Store a question-answer pair as a text document.")
    parser.add_argument("question", help="The question to store.")
    parser.add_argument("answer", help="The answer associated with the question.")
    parser.add_argument(
        "--data-dir",
        default=str(Path(__file__).resolve().parent / "data"),
        help="Destination directory for generated documents (default: %(default)s).",
    )
    return parser


def _slugify(text: str, *, max_length: int = 48) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if not slug:
        slug = "entry"
    if len(slug) > max_length:
        slug = slug[:max_length].rstrip("-")
    return slug


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    filename = f"{timestamp}_{_slugify(args.question)}.txt"
    file_path = data_dir / filename

    content = f"Question: {args.question}\nAnswer: {args.answer}\n"
    file_path.write_text(content, encoding="utf-8")
    print(str(file_path))


if __name__ == "__main__":
    main()
