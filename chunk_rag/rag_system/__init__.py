"""
Hybrid Retrieval and RAG System
==============================

This package implements a simple hybrid retrieval system tailored for a
domain‑specific blog or Q&A service.  It combines lexical and
vector‑based retrieval techniques and fuses the results using
Reciprocal Rank Fusion (RRF).  The system is designed to be easy to
extend – you can add tags to documents, plug in a different embedding
model, or add a shallow graph to capture relationships between
documents at a later date.

Modules
-------

- :mod:`embedding`: A wrapper around OpenAI's embedding API (with
  fallbacks) that converts text into dense vectors.
- :mod:`rrf`: A utility for performing Reciprocal Rank Fusion on
  multiple ranked lists of documents.
- :mod:`hybrid_retrieval`: The heart of the system.  It builds
  separate retrievers for lexical (BM25 or TF‑IDF) and vector
  similarity and fuses their results.
- :mod:`utils`: Helper routines for loading and splitting documents.
- :mod:`main`: A high level interface exposing simple functions to
  initialise the index, add new documents and perform queries.

The code in this package is deliberately self contained and uses
only widely available open source libraries.  It gracefully degrades
when optional dependencies like ``faiss``, ``rank_bm25`` or
``langchain`` are not installed by falling back to pure Python or
scikit‑learn implementations.  When running in your own environment,
you can install these libraries to unlock faster retrieval.

Example
-------

>>> from rag_system.main import initialise_rag, query_rag
>>> index = initialise_rag('data/')
>>> results = query_rag(index, 'How do I install Python?', top_k=5)
>>> for doc in results:
...     print(doc['metadata']['source'])
...     print(doc['content'][:200])

See the docstrings in individual modules for more details.
"""

from .embedding import EmbeddingModel
from .rrf import reciprocal_rank_fusion
from .hybrid_retrieval import HybridRetriever, Document
from .utils import load_documents_from_dir, split_text