"""
utils.py
--------

Helper functions for loading documents from disk and splitting text
into manageable chunks.  Keeping these utilities in a separate module
allows them to be reused or replaced independently of the core
retrieval logic.
"""

from __future__ import annotations

import os
import pathlib
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple


@dataclass
class Document:
    """Simple container for a piece of text and its metadata.

    Attributes
    ----------
    content : str
        The textual content of the document (or chunk).
    metadata : dict
        A dictionary of arbitrary metadata associated with the
        document.  This often includes fields like ``source`` (the
        filename), ``tags`` (list of category labels), and
        ``doc_id`` (a unique identifier for the parent document).
    """

    content: str
    metadata: Dict[str, any]


def split_text(
    text: str, *, chunk_size: int = 800, overlap: int = 50
) -> List[str]:
    """Split text into chunks of roughly ``chunk_size`` tokens.

    Splitting large documents into smaller overlapping chunks helps
    maximise the utility of vector embeddings and BM25 by avoiding
    spill‑over across unrelated paragraphs.  The default values are
    conservative and should work for most use cases, but you can
    customise them as needed.

    Parameters
    ----------
    text : str
        The input text to split.
    chunk_size : int, optional
        Approximate number of tokens or characters per chunk.
    overlap : int, optional
        Number of characters to overlap between adjacent chunks.  A
        small overlap helps preserve context across boundaries.

    Returns
    -------
    list of str
        The list of text chunks.
    """
    if not text:
        return []
    # For simplicity we treat characters as tokens; for more
    # sophisticated splitting you could integrate a tokenizer or
    # sentence boundary detector here.
    chunks = []
    start = 0
    length = len(text)
    while start < length:
        end = min(start + chunk_size, length)
        chunks.append(text[start:end])
        # If we've reached the end of the text, break to avoid an
        # infinite loop when the document length is less than
        # chunk_size but greater than overlap (end - overlap would not
        # advance the pointer).
        if end == length:
            break
        # Move the start pointer forward by chunk_size - overlap
        start = end - overlap
        # Ensure start does not go backwards beyond the beginning
        if start < 0:
            start = 0
    return chunks


def load_documents_from_dir(
    data_dir: str,
    *,
    encoding: str = "utf-8",
    parse_tags: bool = True,
    tag_prefix: str = "tags:"
) -> List[Document]:
    """Recursively load documents from a directory of text files.

    This function walks the directory tree under ``data_dir`` and
    collects all files ending in ``.txt``.  Each file is read into
    memory and split into chunks using :func:`split_text`.  The
    returned list contains one :class:`Document` per chunk; the
    metadata on each chunk includes the original filename (under
    ``source``) and a unique ``doc_id`` derived from the file path.

    The loader also supports a simple convention for assigning tags to
    documents: if the first non‑empty line in a file begins with
    ``tag_prefix``, the remainder of that line is parsed as a
    comma‑separated list of tag names.  Those tags are then stored in
    the ``tags`` field of the metadata.  The prefix and parsing
    behaviour can be customised via the function arguments.

    Parameters
    ----------
    data_dir : str
        Path to the directory containing text files.  Relative paths
        are resolved relative to the current working directory.
    encoding : str, optional
        Text encoding to use when reading files.
    parse_tags : bool, optional
        Whether to look for a tags line at the top of each file.
    tag_prefix : str, optional
        The prefix that indicates a tags line when ``parse_tags`` is
        enabled.  The default is ``'tags:'``.

    Returns
    -------
    list of :class:`Document`
        A list of document chunks ready for indexing.
    """
    docs: List[Document] = []
    base_path = pathlib.Path(data_dir)
    if not base_path.exists():
        raise FileNotFoundError(f"Data directory not found: {data_dir}")
    for path in base_path.rglob("*.txt"):
        with open(path, 'r', encoding=encoding, errors='ignore') as f:
            raw_text = f.read().strip()
        tags: Optional[List[str]] = None
        text_start = 0
        if parse_tags:
            # Check first line for tag prefix
            lines = raw_text.splitlines()
            if lines:
                first_line = lines[0].strip()
                if first_line.lower().startswith(tag_prefix.lower()):
                    # parse tags
                    tag_str = first_line[len(tag_prefix):].strip()
                    tags = [t.strip() for t in tag_str.split(',') if t.strip()]
                    # drop the tags line from the text
                    text_start = raw_text.index("\n") + 1 if "\n" in raw_text else 0
        content_to_split = raw_text[text_start:].strip()
        # If the file is empty after removing the tag line, skip it
        if not content_to_split:
            continue
        chunks = split_text(content_to_split)
        # Use the file path as the document id
        doc_id = str(path.resolve())
        for idx, chunk in enumerate(chunks):
            metadata: Dict[str, any] = {
                'source': str(path.name),
                'doc_id': doc_id,
                'chunk_id': f"{doc_id}::chunk{idx}"
            }
            if tags:
                metadata['tags'] = tags
            docs.append(Document(content=chunk, metadata=metadata))
    return docs