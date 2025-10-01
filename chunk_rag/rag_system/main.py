"""
main.py
-------

This module exposes a set of convenience functions for users who
prefer a simple functional interface over instantiating classes
directly.  It defines a small wrapper around the
:class:`~rag_system.hybrid_retrieval.HybridRetriever` that manages
initialisation, incremental updates and querying.  It also contains a
helper function to generate answers using OpenAI's Chat API given
retrieved context.

If you wish to integrate this into a larger application, feel free
to import the classes from :mod:`rag_system.hybrid_retrieval` directly
and build your own orchestration layer.
"""

from __future__ import annotations

import logging
import os
from typing import List, Optional, Sequence, Tuple

try:
    from openai import OpenAI  # type: ignore
    _OPENAI_AVAILABLE = True
except ImportError:  # pragma: no cover
    OpenAI = None  # type: ignore
    _OPENAI_AVAILABLE = False

_openai_client: Optional[OpenAI] = None

from .env import load_env

load_env()


def _get_openai_client() -> OpenAI:
    """Lazily create and cache an OpenAI client instance."""
    if not _OPENAI_AVAILABLE or OpenAI is None:
        raise RuntimeError(
            "The openai package is not installed; cannot generate answers."
        )
    global _openai_client
    if _openai_client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "OpenAI API key not found; set OPENAI_API_KEY to enable answer generation."
            )
        base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1/")
        try:
            _openai_client = OpenAI(api_key=api_key, base_url=base_url)
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(
                "Failed to initialise OpenAI client; check your configuration."
            ) from exc
    return _openai_client

from .embedding import EmbeddingModel
from .hybrid_retrieval import HybridRetriever
from .utils import Document, load_documents_from_dir

logger = logging.getLogger(__name__)


class RAGClient:
    """High level interface for a retrieval‑augmented generation system.

    This class wraps :class:`~rag_system.hybrid_retrieval.HybridRetriever`
    and exposes simple methods to initialise the index, add new
    documents and query the system.  It also provides an optional
    method to generate answers using OpenAI's chat completion API.
    """

    def __init__(self, index: HybridRetriever) -> None:
        self.index = index

    @classmethod
    def from_directory(
        cls,
        data_dir: str,
        *,
        embedder: Optional[EmbeddingModel] = None
    ) -> "RAGClient":
        """Initialise the retrieval system from a directory of text files.

        Parameters
        ----------
        data_dir : str
            Directory containing `.txt` documents to index.  The
            documents are loaded and split into smaller chunks using
            :func:`rag_system.utils.split_text`.
        embedder : EmbeddingModel, optional
            A preconfigured embedding model.  If omitted a default
            :class:`~rag_system.embedding.EmbeddingModel` instance is
            created using the ``OPENAI_API_KEY`` environment variable.

        Returns
        -------
        RAGClient
            A ready to use RAG client.
        """
        if embedder is None:
            embedder = EmbeddingModel()
        documents = load_documents_from_dir(data_dir)
        cache_dir = os.path.join(data_dir, ".embeddings")
        index = HybridRetriever(documents, embedder, cache_dir=cache_dir)
        return cls(index)

    def add_files(self, file_paths: Sequence[str]) -> None:
        """Add one or more text files to the RAG system.

        The contents of each file are read, split into chunks and
        appended to the existing index.  This operation is incremental
        – previously indexed documents remain untouched.  Files which
        cannot be read are silently skipped.

        Parameters
        ----------
        file_paths : sequence of str
            Absolute or relative paths to `.txt` files.
        """
        new_docs: List[Document] = []
        for file_path in file_paths:
            try:
                docs = load_documents_from_dir(os.path.dirname(file_path), parse_tags=True)
                # filter docs whose doc_id matches the exact file
                # Because load_documents_from_dir reads all .txt files in the folder,
                # we select those corresponding to the requested path.
                norm = os.path.abspath(file_path)
                for doc in docs:
                    if doc.metadata['doc_id'] == norm:
                        new_docs.append(doc)
            except Exception as e:
                logger.warning("Failed to load %s: %s", file_path, e)
        if new_docs:
            self.index.add_documents(new_docs)

    def save_index(self, directory: str) -> None:
        """Persist the underlying index to ``directory``."""
        self.index.save(directory)

    def retrieve(
        self,
        query: str,
        *,
        top_k: int = 5,
        tags: Optional[Sequence[str]] = None
    ) -> List[Tuple[Document, float]]:
        """Retrieve relevant document chunks for a given query.

        Parameters
        ----------
        query : str
            The user's question or search phrase.
        top_k : int
            Number of results to return.
        tags : sequence of str, optional
            Restrict retrieval to documents containing at least one of
            the provided tags.

        Returns
        -------
        list of (Document, float)
            Document chunks and their scores.
        """
        return self.index.retrieve(query, top_k=top_k, tags=tags)

    def generate_answer(
        self,
        query: str,
        *,
        top_k: int = 5,
        tags: Optional[Sequence[str]] = None,
        model: str = "gpt-4o", # gpt-4o-mini
        temperature: float = 0.2,
        max_tokens: int = 1024,
    ) -> str:
        """Generate a natural language answer using retrieved context.

        This function first performs a hybrid retrieval to obtain the
        most relevant document chunks and then constructs a prompt for
        OpenAI's chat completion API.  The prompt instructs the model
        to answer the question using only the provided context.  If
        the OpenAI client library is not installed or no API key is
        configured, a RuntimeError is raised.

        Parameters
        ----------
        query : str
            The user's question.
        top_k : int
            Number of context passages to use.  A larger value can
            provide more background at the cost of potential noise.
        tags : sequence of str, optional
            Restrict retrieval to documents containing specific tags.
        model : str
            Which OpenAI chat model to use.  Defaults to
            ``gpt-4o``.
        temperature : float
            Sampling temperature for the language model.
        max_tokens : int
            Maximum number of tokens to generate.  Increase this if answers
            are truncated.

        Returns
        -------
        str
            The generated answer.
        """
        client = _get_openai_client()
        context_docs = self.retrieve(query, top_k=top_k, tags=tags)
        if not context_docs:
            return "I'm sorry, I couldn't find any relevant information to answer your question."
        # Build a prompt with sources and contents
        sources = []
        for doc, score in context_docs:
            # include source name and snippet
            source_line = f"Source: {doc.metadata.get('source')}"
            content_line = doc.content.replace('\n', ' ').strip()
            sources.append(f"{source_line}\n{content_line}")
        context_str = "\n\n".join(sources)
        system_prompt = (
            "You are a helpful assistant for a technical Q&A service. "
            # "Answer the user's question using only the provided context. "
            "I will first give you some context to reference, then I will ask you a question. "
            "If the answer is not contained in the context, respond with your own knowledge."
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Some content for you to reference:\n{context_str}\n\nQuestion: {query}\nAnswer:"},
        ]
        # Call the OpenAI chat completion API
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except Exception as exc:  # pragma: no cover
            logger.error("OpenAI chat completion failed: %s", exc)
            raise
        choice = response.choices[0]
        if getattr(choice, "finish_reason", None) == "length":
            logger.warning(
                "OpenAI completion stopped because of max_tokens limit; consider increasing max_tokens."
            )
        message = choice.message.content
        return message.strip() if message else ""


def initialise_rag(data_dir: str) -> RAGClient:
    """Initialise a retrieval system from a directory of text files.

    This is a thin wrapper around :meth:`RAGClient.from_directory` for
    convenience.  It returns a :class:`RAGClient` instance ready for
    querying and incremental updates.
    """
    return RAGClient.from_directory(data_dir)


def add_document_to_rag(client: RAGClient, file_path: str) -> None:
    """Add a single document to an existing RAGClient.

    Parameters
    ----------
    client : RAGClient
        The client to which the document should be added.
    file_path : str
        Path to a `.txt` file.  If the file contains a ``tags:`` line
        at the top, the tags will be associated with all its chunks.
    """
    client.add_files([file_path])


def query_rag(
    client: RAGClient,
    question: str,
    *,
    top_k: int = 5,
    tags: Optional[Sequence[str]] = None
) -> List[Tuple[Document, float]]:
    """Retrieve relevant context for a question.

    Parameters
    ----------
    client : RAGClient
        An initialised retrieval system.
    question : str
        The search query or user question.
    top_k : int
        How many pieces of context to return.
    tags : sequence of str, optional
        Restrict retrieval to documents labelled with these tags.

    Returns
    -------
    list of (Document, float)
        The retrieved document chunks and their fused scores.
    """
    return client.retrieve(question, top_k=top_k, tags=tags)


def answer_question(
    client: RAGClient,
    question: str,
    *,
    top_k: int = 5,
    tags: Optional[Sequence[str]] = None,
    model: str = "gpt-4o",
    temperature: float = 0.2,
    max_tokens: int = 1024
) -> str:
    """Generate an answer to a question using retrieved context.

    This is a thin wrapper around :meth:`RAGClient.generate_answer`.
    """
    return client.generate_answer(
        question,
        top_k=top_k,
        tags=tags,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
    )
