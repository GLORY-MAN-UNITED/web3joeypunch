"""
hybrid_retrieval.py
-------------------

This module implements a simple hybrid retrieval system that
combines lexical (BM25/TF‑IDF) and dense vector (embedding) search
into a single ranked list using Reciprocal Rank Fusion (RRF).  It
stores documents and their metadata, builds indices as needed and
exposes a convenient API for querying the index and for adding new
documents at runtime.

Key classes defined here:

- :class:`HybridRetriever`: Coordinates the lexical and vector
  retrievers, fuses their results and returns Document objects.
- :class:`LexicalRetriever`: Wraps BM25 or TF‑IDF based retrieval.
- :class:`VectorRetriever`: Wraps a FAISS or cosine similarity based
  nearest neighbour index.

These classes are intentionally lightweight.  They do not depend on
``langchain`` so they can run with a minimal set of dependencies.
However, if ``rank_bm25`` or ``faiss`` are installed they will be
used automatically for better performance.
"""

from __future__ import annotations

import json
import logging
import math
import os
import hashlib
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np  # type: ignore

from .embedding import EmbeddingModel
from .rrf import reciprocal_rank_fusion
from .utils import Document

logger = logging.getLogger(__name__)


def _documents_to_serialisable(documents: List[Document]) -> List[Dict[str, object]]:
    """Convert documents to a JSON serialisable list."""
    serialised: List[Dict[str, object]] = []
    for doc in documents:
        serialised.append({
            "content": doc.content,
            "metadata": doc.metadata,
        })
    return serialised


def _documents_from_serialised(payload: List[Dict[str, object]]) -> List[Document]:
    """Recreate Document objects from saved JSON."""
    documents: List[Document] = []
    for item in payload:
        content = item.get("content", "")
        metadata = item.get("metadata", {})
        documents.append(Document(content=content, metadata=metadata))
    return documents


# Attempt to import rank_bm25; fall back to a TF‑IDF implementation
try:
    from rank_bm25 import BM25Okapi  # type: ignore
    _BM25_AVAILABLE = True
except ImportError:  # pragma: no cover
    BM25Okapi = None  # type: ignore
    _BM25_AVAILABLE = False

try:
    import faiss  # type: ignore
    _FAISS_AVAILABLE = True
except ImportError:  # pragma: no cover
    faiss = None  # type: ignore
    _FAISS_AVAILABLE = False

try:
    from sklearn.metrics.pairwise import cosine_similarity  # type: ignore
    _SKLEARN_COSINE_AVAILABLE = True
except ImportError:  # pragma: no cover
    cosine_similarity = None  # type: ignore
    _SKLEARN_COSINE_AVAILABLE = False


class LexicalRetriever:
    """A lexical retriever using BM25 or TF‑IDF.

    The retriever tokenises documents by simple whitespace splitting
    and uses BM25Okapi from the ``rank_bm25`` package when available.
    If ``rank_bm25`` is not installed the retriever falls back to a
    simple TF‑IDF matrix with cosine similarity.
    """

    def __init__(self, documents: List[Document]):
        """
        Initialise the lexical retriever.

        We first try to use ``rank_bm25`` if it is installed.  Failing
        that, we fall back to a pure Python BM25 implementation.  The
        fallback does not require scikit‑learn and therefore avoids
        heavy dependencies that may not be available in restricted
        environments.
        """
        # store documents and their tokenised forms
        self.documents = documents
        self.corpus_tokens: List[List[str]] = [doc.content.split() for doc in documents]
        if _BM25_AVAILABLE:
            self.bm25 = BM25Okapi(self.corpus_tokens)
            self.use_bm25_library = True
        else:
            self.use_bm25_library = False
            # Build our own BM25 statistics
            self._build_bm25_stats()

    # For the fallback BM25 we precompute IDF and term frequencies
    def _build_bm25_stats(self) -> None:
        # BM25 parameters
        self.k1 = 1.5
        self.b = 0.75
        self.doc_lens: List[int] = [len(tokens) for tokens in self.corpus_tokens]
        self.avgdl = sum(self.doc_lens) / max(1, len(self.doc_lens))
        # document frequency per term
        import collections
        df = collections.Counter()
        for tokens in self.corpus_tokens:
            unique_tokens = set(tokens)
            for t in unique_tokens:
                df[t] += 1
        # compute IDF using BM25 formula
        N = len(self.corpus_tokens)
        self.idf: Dict[str, float] = {}
        for term, f in df.items():
            # plus 0.5 to avoid division by zero
            self.idf[term] = math.log((N - f + 0.5) / (f + 0.5) + 1)
        # term frequencies per document
        self.tf: List[Dict[str, int]] = []
        for tokens in self.corpus_tokens:
            tf_doc: Dict[str, int] = {}
            for t in tokens:
                tf_doc[t] = tf_doc.get(t, 0) + 1
            self.tf.append(tf_doc)


    def add_documents(self, new_documents: List[Document]) -> None:
        """Add new documents to the lexical index.

        When using BM25 this simply appends new tokenised documents to
        the corpus; when using TF‑IDF the entire matrix is rebuilt.  If
        you expect to add documents often at runtime you may want to
        install the ``rank_bm25`` package.
        """
        if not new_documents:
            return
        self.documents.extend(new_documents)
        new_tokens = [doc.content.split() for doc in new_documents]
        self.corpus_tokens.extend(new_tokens)
        if self.use_bm25_library:
            # rebuild BM25Okapi index
            self.bm25 = BM25Okapi(self.corpus_tokens)
        else:
            # rebuild fallback statistics
            self._build_bm25_stats()

    def retrieve(self, query: str, top_k: int = 10) -> List[int]:
        """Return the indices of the top ``top_k`` documents.

        The returned list contains indices into ``self.documents``.
        """
        if not query.strip():
            return []
        tokens = query.split()
        if self.use_bm25_library:
            scores = self.bm25.get_scores(tokens)
            ranked = np.argsort(scores)[::-1][:top_k]
            return ranked.tolist()
        else:
            # fallback BM25
            scores: List[float] = []
            for i, (tf_doc, doc_len) in enumerate(zip(self.tf, self.doc_lens)):
                score = 0.0
                for t in tokens:
                    if t not in tf_doc:
                        continue
                    idf = self.idf.get(t, 0.0)
                    f = tf_doc[t]
                    numerator = f * (self.k1 + 1)
                    denom = f + self.k1 * (1 - self.b + self.b * doc_len / self.avgdl)
                    score += idf * (numerator / denom)
                scores.append(score)
            ranked = np.argsort(scores)[::-1][:top_k]
            return ranked.tolist()


class VectorRetriever:
    """Dense vector retriever using FAISS or cosine similarity.

    The retriever holds a list of embeddings for each document chunk
    and supports nearest neighbour queries using either a FAISS index
    (recommended) or, if FAISS is unavailable, brute force cosine
    similarity via numpy or scikit‑learn.
    """

    def __init__(self, embeddings: np.ndarray):
        # embeddings is of shape (N, D)
        self.embeddings = embeddings.astype('float32')
        self.num_vectors, self.dim = self.embeddings.shape
        if _FAISS_AVAILABLE and self.num_vectors > 0:
            # build a simple L2 index; we normalise vectors to unit
            # length so L2 and cosine distance are equivalent
            self.index = faiss.IndexFlatIP(self.dim)
            # normalise vectors
            faiss.normalize_L2(self.embeddings)
            self.index.add(self.embeddings)
            self.use_faiss = True
        else:
            self.use_faiss = False
            # ensure scikit or numpy is available
            if not _SKLEARN_COSINE_AVAILABLE:
                # We'll fall back to manual dot products with normalisation
                pass
        # Precompute norms for brute force cosine
        if not self.use_faiss:
            # normalise embeddings to unit length to accelerate dot product
            norm = np.linalg.norm(self.embeddings, axis=1, keepdims=True)
            norm[norm == 0] = 1
            self.normalised = self.embeddings / norm

    def add_embeddings(self, new_embeddings: np.ndarray) -> None:
        """Add new embeddings to the vector index.

        When using FAISS the embeddings are appended to the existing
        index; otherwise they are concatenated to the internal arrays.
        """
        if new_embeddings.size == 0:
            return
        new_embeddings = new_embeddings.astype('float32')
        if self.use_faiss:
            # Normalise new embeddings and add to index
            faiss.normalize_L2(new_embeddings)
            self.index.add(new_embeddings)
            # Keep a copy so we can save the index later if needed
            self.embeddings = np.vstack([self.embeddings, new_embeddings]) if self.embeddings.size else new_embeddings
            self.num_vectors = self.embeddings.shape[0]
            if self.num_vectors:
                self.dim = self.embeddings.shape[1]
        else:
            # Extend internal arrays
            if self.embeddings.size == 0:
                self.embeddings = new_embeddings
            else:
                self.embeddings = np.vstack([self.embeddings, new_embeddings])
            # Recompute normalised vectors
            norm = np.linalg.norm(self.embeddings, axis=1, keepdims=True)
            norm[norm == 0] = 1
            self.normalised = self.embeddings / norm
            self.num_vectors = self.embeddings.shape[0]
            self.dim = self.embeddings.shape[1] if self.num_vectors else 0

    def query(self, query_embedding: np.ndarray, top_k: int = 10) -> List[int]:
        """Return indices of the nearest vectors to the query embedding.

        Parameters
        ----------
        query_embedding : np.ndarray
            Shape (D,) or (1, D).  Should already be normalised when
            using FAISS.
        top_k : int, optional
            Number of nearest neighbours to retrieve.

        Returns
        -------
        list of int
            Indices into the embedding array.
        """
        if self.num_vectors == 0:
            return []
        q = query_embedding.astype('float32')
        if q.ndim == 1:
            q = q.reshape(1, -1)
        if self.use_faiss:
            # Normalise query embedding
            faiss.normalize_L2(q)
            sims, ids = self.index.search(q, top_k)
            # ids is (1, top_k)
            return ids[0].tolist()
        else:
            # compute cosine similarity with brute force
            # normalise query
            norm = np.linalg.norm(q)
            if norm == 0:
                return []
            q_norm = q / norm
            sims = np.dot(self.normalised, q_norm.T).flatten()
            ranked = np.argsort(sims)[::-1][:top_k]
            return ranked.tolist()


class HybridRetriever:
    """Coordinate lexical and vector retrieval and fuse the results.

    This class is responsible for maintaining the list of documents
    along with their embeddings, exposing simple methods to add new
    documents and to perform hybrid queries.
    """

    def __init__(
        self,
        documents: List[Document],
        embedder: EmbeddingModel,
        *,
        cache_dir: Optional[str] = None,
    ):
        # Keep a flat list of document chunks
        self.documents: List[Document] = list(documents)
        self.embedder = embedder
        self.cache_dir = cache_dir
        if self.cache_dir:
            os.makedirs(self.cache_dir, exist_ok=True)
        # Create embeddings for all documents, leveraging cache if available
        self.embeddings = self._embeddings_from_documents(self.documents)
        # Build retrievers
        self.lexical_retriever = LexicalRetriever(self.documents)
        self.vector_retriever = VectorRetriever(self.embeddings)

    @classmethod
    def load(
        cls,
        directory: str,
        embedder: Optional[EmbeddingModel] = None,
        *,
        cache_dir: Optional[str] = None,
    ) -> "HybridRetriever":
        """Load a previously saved retriever from ``directory``."""
        docs_path = os.path.join(directory, "documents.json")
        embeddings_path = os.path.join(directory, "embeddings.npy")
        if not os.path.exists(docs_path) or not os.path.exists(embeddings_path):
            raise FileNotFoundError(
                "Could not locate saved index; expected documents.json and embeddings.npy."
            )
        if embedder is None:
            embedder = EmbeddingModel()
        with open(docs_path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        documents_data = payload.get("documents", [])
        documents = _documents_from_serialised(documents_data)
        embeddings = np.load(embeddings_path)
        instance = cls.__new__(cls)
        instance.documents = documents
        instance.embeddings = embeddings.astype('float32')
        instance.embedder = embedder
        instance.lexical_retriever = LexicalRetriever(instance.documents)
        instance.vector_retriever = VectorRetriever(instance.embeddings)
        instance.cache_dir = cache_dir
        if instance.cache_dir:
            os.makedirs(instance.cache_dir, exist_ok=True)
        return instance

    def _cache_path_for_doc(self, doc_id: str) -> Optional[str]:
        if not self.cache_dir:
            return None
        safe_name = hashlib.sha256(doc_id.encode("utf-8")).hexdigest()
        return os.path.join(self.cache_dir, f"{safe_name}.json")

    def _load_cached_embeddings(self, doc_id: str) -> Optional[Dict[str, List[float]]]:
        cache_path = self._cache_path_for_doc(doc_id)
        if not cache_path or not os.path.exists(cache_path):
            return None
        try:
            with open(cache_path, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except Exception:
            logger.warning("Failed to load cached embeddings for %s; recomputing.", doc_id)
            return None
        if payload.get("doc_id") != doc_id:
            return None
        chunk_ids = payload.get("chunk_ids", [])
        vectors = payload.get("embeddings", [])
        if len(chunk_ids) != len(vectors):
            return None
        cache: Dict[str, List[float]] = {}
        for chunk_id, vector in zip(chunk_ids, vectors):
            cache[chunk_id] = vector
        return cache

    def _save_cached_embeddings(
        self,
        doc_id: str,
        chunk_ids: Sequence[str],
        embeddings: Sequence[Sequence[float]],
    ) -> None:
        cache_path = self._cache_path_for_doc(doc_id)
        if not cache_path:
            return
        payload = {
            "doc_id": doc_id,
            "chunk_ids": list(chunk_ids),
            "embeddings": [list(vec) for vec in embeddings],
            "model": getattr(self.embedder, "model_name", ""),
        }
        try:
            with open(cache_path, "w", encoding="utf-8") as fh:
                json.dump(payload, fh)
        except Exception as exc:
            logger.warning("Failed to write embedding cache for %s: %s", doc_id, exc)

    def _embeddings_from_documents(self, documents: Sequence[Document]) -> np.ndarray:
        if not documents:
            return np.zeros((0, 0), dtype='float32')
        embeddings_lookup: Dict[str, Sequence[float]] = {}
        docs_by_id: Dict[str, List[Document]] = {}
        for doc in documents:
            doc_id = doc.metadata.get('doc_id')
            chunk_id = doc.metadata.get('chunk_id')
            if not doc_id or not chunk_id:
                raise ValueError("Each document must contain 'doc_id' and 'chunk_id' in metadata.")
            docs_by_id.setdefault(doc_id, []).append(doc)
        for doc_id, doc_group in docs_by_id.items():
            cached_vectors = self._load_cached_embeddings(doc_id) if self.cache_dir else None
            vector_map: Dict[str, Sequence[float]] = dict(cached_vectors or {})
            missing_docs: List[Document] = []
            for doc in doc_group:
                chunk_id = doc.metadata['chunk_id']
                if chunk_id in vector_map:
                    embeddings_lookup[chunk_id] = vector_map[chunk_id]
                else:
                    missing_docs.append(doc)
            if missing_docs:
                texts = [doc.content for doc in missing_docs]
                new_vectors = self.embedder.embed_texts(texts)
                for doc, vec in zip(missing_docs, new_vectors):
                    chunk_id = doc.metadata['chunk_id']
                    embeddings_lookup[chunk_id] = vec
                    vector_map[chunk_id] = vec
                if self.cache_dir:
                    chunk_ids = [doc.metadata['chunk_id'] for doc in doc_group]
                    ordered_vecs = [vector_map[cid] for cid in chunk_ids]
                    self._save_cached_embeddings(doc_id, chunk_ids, ordered_vecs)
            else:
                for doc in doc_group:
                    chunk_id = doc.metadata['chunk_id']
                    embeddings_lookup[chunk_id] = vector_map[chunk_id]
        ordered_vectors: List[Sequence[float]] = []
        for doc in documents:
            chunk_id = doc.metadata['chunk_id']
            vector = embeddings_lookup.get(chunk_id)
            if vector is None:
                raise RuntimeError(f"Missing embedding for chunk {chunk_id}")
            ordered_vectors.append(vector)
        if not ordered_vectors:
            return np.zeros((0, 0), dtype='float32')
        return np.array(ordered_vectors, dtype='float32')

    def add_documents(self, new_docs: List[Document]) -> None:
        """Add new document chunks to the index.

        New documents are embedded, appended to the internal list and
        incorporated into both lexical and vector indices.  You can
        call this method repeatedly to keep the index up to date as
        your blog content evolves.
        """
        if not new_docs:
            return
        # Embed new documents
        new_embeddings = self._embeddings_from_documents(new_docs)
        if new_embeddings.size == 0:
            return
        # Extend lists
        self.documents.extend(new_docs)
        # Append embeddings
        if self.embeddings.size == 0:
            self.embeddings = new_embeddings
        else:
            self.embeddings = np.vstack([self.embeddings, new_embeddings])
        # Update lexical and vector retrievers
        self.lexical_retriever.add_documents(new_docs)
        self.vector_retriever.add_embeddings(new_embeddings)

    def retrieve(self, query: str, top_k: int = 10, *, tags: Optional[Sequence[str]] = None) -> List[Tuple[Document, float]]:
        """Retrieve documents relevant to the query.

        This method performs both lexical and vector retrieval, fuses
        the results using RRF and returns the top ``top_k`` distinct
        document chunks along with their fused scores.  You may supply
        a list of ``tags`` to restrict the candidate documents to
        those labelled with at least one of the given tags.  If no
        tags are specified all documents are considered.

        Parameters
        ----------
        query : str
            The natural language query to search for.
        top_k : int
            The number of results to return.  Since fusion may
            reintroduce duplicates from both lists, the actual number
            of documents considered from each retriever may be larger.
        tags : sequence of str, optional
            If provided, restrict retrieval to documents whose
            metadata contains at least one of these tags.

        Returns
        -------
        list of (Document, float)
            A list of document chunks and their fused scores, sorted
            from most to least relevant.
        """
        if not query.strip():
            return []
        # Determine how many candidates to pull from each retriever
        # We pull more than top_k to allow RRF to work effectively
        k_each = max(top_k * 2, 10)
        lex_indices = self.lexical_retriever.retrieve(query, top_k=k_each)
        # embed query
        q_embedding = self.embedder.embed_texts([query])[0]
        vec_indices = self.vector_retriever.query(np.array(q_embedding), top_k=k_each)
        # Optionally filter by tags
        def filter_indices(indices: List[int]) -> List[int]:
            if not tags:
                return indices
            allowed = []
            tagset = set(t.lower() for t in tags)
            for idx in indices:
                doc_tags = self.documents[idx].metadata.get('tags')
                if doc_tags:
                    # case insensitive matching
                    if any(t.lower() in tagset for t in doc_tags):
                        allowed.append(idx)
            return allowed
        lex_indices = filter_indices(lex_indices)
        vec_indices = filter_indices(vec_indices)
        # Convert indices to document IDs for fusion
        lex_ids = [str(idx) for idx in lex_indices]
        vec_ids = [str(idx) for idx in vec_indices]
        # Fuse with RRF
        fused = reciprocal_rank_fusion([lex_ids, vec_ids])
        # Keep only top_k results and map back to documents
        results: List[Tuple[Document, float]] = []
        count = 0
        for doc_id_str, score in fused:
            idx = int(doc_id_str)
            results.append((self.documents[idx], score))
            count += 1
            if count >= top_k:
                break
        return results

    def save(self, directory: str) -> None:
        """Persist the current documents and embeddings to ``directory``."""
        os.makedirs(directory, exist_ok=True)
        docs_path = os.path.join(directory, "documents.json")
        embeddings_path = os.path.join(directory, "embeddings.npy")
        payload = {"documents": _documents_to_serialisable(self.documents)}
        with open(docs_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        np.save(embeddings_path, self.embeddings)
