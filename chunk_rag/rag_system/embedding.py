"""
embedding.py
------------

This module defines the :class:`EmbeddingModel` class which wraps
OpenAI's embedding API.  It is responsible for converting natural
language text into dense vector representations suitable for
approximate nearest neighbour search.  If the OpenAI Python client
library is not installed or an API key is not supplied, the class
falls back to a simple TF‑IDF based embedding using scikit‑learn.

By isolating the embedding logic in its own module, you can swap in
other embedding models (e.g. Sentence‑Transformers) in the future
without touching the retrieval code.
"""

from __future__ import annotations

import logging
import os
from typing import Iterable, List, Optional

try:
    from openai import OpenAI  # type: ignore
    _OPENAI_AVAILABLE = True
except ImportError:  # pragma: no cover
    OpenAI = None  # type: ignore
    _OPENAI_AVAILABLE = False

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.preprocessing import normalize
    _SKLEARN_AVAILABLE = True
except ImportError:  # pragma: no cover
    TfidfVectorizer = None  # type: ignore
    normalize = None  # type: ignore
    _SKLEARN_AVAILABLE = False

from .env import load_env

logger = logging.getLogger(__name__)

load_env()


class EmbeddingModel:
    """Compute embeddings for a collection of texts.

    The default implementation uses OpenAI's ``text-embedding-3-small``
    model.  You can override the model by passing a different
    ``model_name`` when constructing the object.  If the OpenAI
    library is not installed or no API key is configured, the class
    will fall back to using a TF‑IDF vectoriser from scikit‑learn.

    Parameters
    ----------
    model_name : str, optional
        The name of the OpenAI embedding model.  Ignored when
        falling back to TF‑IDF.  Defaults to ``text-embedding-3-small``.
    openai_api_key : str, optional
        Explicit OpenAI API key.  If omitted, the ``OPENAI_API_KEY``
        environment variable is used.
    """

    def __init__(self, model_name: str = "text-embedding-3-small",
                 openai_api_key: Optional[str] = None) -> None:
        self.model_name = model_name
        # Determine whether we can use OpenAI
        self.use_openai = _OPENAI_AVAILABLE
        self._client: Optional[OpenAI] = None
        if self.use_openai:
            api_key = openai_api_key or os.getenv("OPENAI_API_KEY")
            if api_key:
                base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1/")
                try:
                    self._client = OpenAI(api_key=api_key, base_url=base_url)
                except Exception as exc:  # pragma: no cover
                    logger.warning(
                        "Failed to initialise OpenAI client (%s); falling back to TF‑IDF embeddings.",
                        exc,
                    )
                    self.use_openai = False
            else:
                # Without a key we cannot call the API
                logger.warning(
                    "OpenAI API key not found; falling back to TF‑IDF embeddings.")
                self.use_openai = False
        # Prepare TF‑IDF vectoriser as fallback
        self._tfidf_vectoriser: Optional[TfidfVectorizer] = None
        if not self.use_openai and not _SKLEARN_AVAILABLE:
            raise RuntimeError(
                "Neither OpenAI nor scikit‑learn is available. "
                "Install one of them or supply an API key to use embeddings.")

    def _ensure_tfidf_fitted(self, texts: Iterable[str]) -> None:
        """Ensure the TF‑IDF vectoriser is fitted on the given texts.

        If the vectoriser hasn't been initialised yet, this will fit
        it on the provided texts.  Subsequent calls will reuse the
        fitted model.  Note that TF‑IDF performs best when fitted on
        the entire corpus; you should therefore pass in all documents
        when initialising the index.
        """
        if self._tfidf_vectoriser is None:
            assert _SKLEARN_AVAILABLE  # sanity check
            # Use simple whitespace tokenisation and keep case
            texts_list = list(texts)
            self._tfidf_vectoriser = TfidfVectorizer(
                tokenizer=lambda s: s.split(),
                preprocessor=None,
                lowercase=False,
                norm=None,
                token_pattern=None,
            )
            logger.info("Fitting TF‑IDF vectoriser on %d documents", len(texts_list))
            # Fit vectoriser
            self._tfidf_vectoriser.fit(texts_list)

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """Embed multiple texts into dense vectors.

        This function batches requests where possible.  When using
        OpenAI it will send a single API call for the entire list of
        inputs; when falling back to TF‑IDF, it will transform them
        using the fitted vectoriser.

        Parameters
        ----------
        texts : list of str
            The raw text of each document or query.

        Returns
        -------
        list of list of float
            The embedding vectors for each text.
        """
        if not texts:
            return []
        if self.use_openai and self._client is not None:
            # call OpenAI embedding API
            try:
                response = self._client.embeddings.create(
                    model=self.model_name,
                    input=texts,
                )
            except Exception as exc:  # pragma: no cover
                # If the API call fails, log and fall back to TF‑IDF
                logger.error("OpenAI embedding request failed: %s; falling back to TF‑IDF", exc)
                self.use_openai = False
                self._client = None
                return self.embed_texts(texts)
            # Extract embeddings in order of input
            # The API returns a list of dicts with index and embedding
            ordered = sorted(response.data, key=lambda x: x.index)
            return [item.embedding for item in ordered]
        else:
            # Fallback to TF‑IDF embeddings
            assert _SKLEARN_AVAILABLE
            # Make sure TF‑IDF is fitted
            # We pass the full set of texts when fitting; for queries the
            # vectoriser should already be fitted on the corpus
            if self._tfidf_vectoriser is None:
                self._ensure_tfidf_fitted(texts)
            vectors = self._tfidf_vectoriser.transform(texts)
            # Normalise to unit length to simulate cosine similarity
            vectors = normalize(vectors, norm='l2')
            return vectors.toarray().tolist()
