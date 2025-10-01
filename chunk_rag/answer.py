"""CLI entry point to answer a question using the RAG system."""

from __future__ import annotations

import argparse
from pathlib import Path

from rag_system.main import answer_question, initialise_rag


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Answer a question using the local RAG index.")
    parser.add_argument("question", help="Question to ask the RAG system.")
    parser.add_argument(
        "--data-dir",
        default=str(Path(__file__).resolve().parent / "data"),
        help="Directory containing source documents (default: %(default)s).",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=5,
        help="Number of context chunks to retrieve before answering (default: %(default)s).",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=1024,
        help="Maximum tokens to generate in the answer (default: %(default)s).",
    )
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    client = initialise_rag(args.data_dir)
    answer = answer_question(
        client,
        args.question,
        top_k=args.top_k,
        max_tokens=args.max_tokens,
    )
    print(answer)


if __name__ == "__main__":
    main()
