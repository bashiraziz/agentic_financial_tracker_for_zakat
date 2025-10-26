from __future__ import annotations

import re
from functools import lru_cache
from difflib import SequenceMatcher
from typing import Dict, Iterable, List, Optional, Set, Tuple

from backend.services.edgar_client import get_edgar_client

MAPPING_URL = "https://www.sec.gov/files/company_tickers.json"

NAME_SUFFIXES = {
    "inc",
    "incorporated",
    "corporation",
    "corp",
    "co",
    "co.",
    "company",
    "ltd",
    "ltd.",
    "limited",
    "plc",
    "sa",
    "nv",
    "ag",
    "class",
    "series",
    "a",
    "b",
    "c",
}


def _normalize(text: str) -> Tuple[str, Set[str]]:
    lowered = text.lower()
    lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
    tokens = [token for token in lowered.split() if token and token not in NAME_SUFFIXES]
    normalized = " ".join(tokens)
    return normalized, set(tokens)


@lru_cache(maxsize=1)
def _load_mapping() -> Dict[str, List[Tuple[str, str, Set[str]]]]:
    client = get_edgar_client()
    response = client._client.get(MAPPING_URL)  # type: ignore[attr-defined]
    response.raise_for_status()
    data = response.json()

    index: Dict[str, List[Tuple[str, str, Set[str]]]] = {}
    fallback: List[Tuple[str, str, Set[str]]] = []

    for entry in data.values():
        ticker = entry.get("ticker")
        title = entry.get("title")
        if not ticker or not title:
            continue
        normalized, tokens = _normalize(title)
        if not normalized or not tokens:
            continue
        first_char = normalized[0]
        index.setdefault(first_char, []).append((ticker.upper(), normalized, tokens))
        fallback.append((ticker.upper(), normalized, tokens))

    index.setdefault("*", fallback)
    return index


def lookup_ticker_for_name(name: str) -> Optional[str]:
    normalized, tokens = _normalize(name)
    if not normalized or not tokens:
        return None

    mapping = _load_mapping()
    first_char = normalized[0]
    candidates = list(mapping.get(first_char, []))
    candidates.extend(mapping.get("*", []))

    best_score = 0.0
    best_ticker: Optional[str] = None

    for ticker, normalized_title, candidate_tokens in candidates:
        overlap = len(tokens & candidate_tokens)
        similarity = SequenceMatcher(None, normalized, normalized_title).ratio()
        if overlap >= max(2, len(tokens) // 2 + 1) or similarity >= 0.9:
            if similarity > best_score:
                best_score = similarity
                best_ticker = ticker

    if best_score >= 0.75:
        return best_ticker
    return None
