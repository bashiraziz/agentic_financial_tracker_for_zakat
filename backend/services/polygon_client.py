from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Optional, Tuple

import httpx
from difflib import SequenceMatcher


class PolygonClient:
    """Thin HTTP client for Polygon.io endpoints used by the valuation service."""

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None) -> None:
        self.api_key = api_key or os.getenv("POLYGON_API_KEY")
        if not self.api_key:
            raise RuntimeError(
                "POLYGON_API_KEY is missing. Set it in your environment or .env file."
            )
        resolved_base_url = base_url or os.getenv("POLYGON_BASE_URL", "https://api.polygon.io")
        self._client = httpx.Client(
            base_url=resolved_base_url,
            timeout=10.0,
            headers={"Accept-Encoding": "gzip, deflate"},
        )

    def close(self) -> None:
        self._client.close()

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        query = params.copy() if params else {}
        query["apiKey"] = self.api_key
        response = self._client.get(path, params=query)
        response.raise_for_status()
        return response.json()

    @lru_cache(maxsize=256)
    def get_daily_close(
        self,
        ticker: str,
        as_of: date,
        lookback_days: int = 120,
    ) -> Tuple[Optional[float], Optional[date]]:
        start = as_of - timedelta(days=lookback_days)
        payload = self._get(
            f"/v2/aggs/ticker/{ticker.upper()}/range/1/day/{start.isoformat()}/{as_of.isoformat()}",
            {"adjusted": "true", "sort": "desc", "limit": lookback_days + 5},
        )
        if payload.get("status") != "OK":
            raise RuntimeError(f"Polygon aggregates status {payload.get('status')}")
        for entry in payload.get("results", []):
            if not isinstance(entry, dict):
                continue
            timestamp = entry.get("t")
            close = entry.get("c")
            if timestamp is None or close is None:
                continue
            entry_date = datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).date()
            if entry_date <= as_of:
                return float(close), entry_date
        return None, None

    @lru_cache(maxsize=128)
    def get_etf_holdings(self, ticker: str) -> List[Dict[str, Any]]:
        payload = self._get(
            f"/v3/reference/etfs/{ticker.upper()}/holdings",
            {"limit": 1000, "include_weights": "true"},
        )
        if payload.get("status") != "OK":
            raise RuntimeError(f"Polygon ETF holdings status {payload.get('status')}")
        return payload.get("results", []) or []

    @lru_cache(maxsize=256)
    def get_ticker_details(self, ticker: str) -> Optional[Dict[str, Any]]:
        payload = self._get(f"/v3/reference/tickers/{ticker.upper()}")
        return payload.get("results")

    def lookup_ticker(self, identifier_type: str, identifier: str) -> Optional[str]:
        params: Dict[str, Any] = {
            identifier_type: identifier,
            "limit": 1,
        }
        payload = self._get("/v3/reference/tickers", params)
        results = payload.get("results") or []
        if results:
            ticker = results[0].get("ticker")
            if ticker:
                return str(ticker).upper()
        return None

    @lru_cache(maxsize=256)
    def search_tickers(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        payload = self._get(
            "/v3/reference/tickers",
            {
                "search": query,
                "active": "true",
                "market": "stocks",
                "limit": limit,
            },
        )
        return payload.get("results") or []

    def match_ticker_by_name(self, query: str) -> Optional[str]:
        normalized = query.strip()
        if not normalized:
            return None

        query_tokens = set(word for word in normalized.lower().replace(",", " ").replace(".", " ").replace("(", " ").replace(")", " ").split() if word)
        if not query_tokens:
            return None

        candidates = self.search_tickers(normalized, limit=10)
        for candidate in candidates:
            ticker = candidate.get("ticker")
            if not ticker:
                continue
            name = (candidate.get("name") or "").lower()
            description = (candidate.get("description") or "").lower()
            name_tokens = set(word for word in name.replace(",", " ").replace(".", " ").split() if word)
            desc_tokens = set(word for word in description.replace(",", " ").replace(".", " ").split() if word)
            overlap = max(len(query_tokens & name_tokens), len(query_tokens & desc_tokens))
            similarity = max(SequenceMatcher(None, normalized.lower(), name).ratio(), SequenceMatcher(None, normalized.lower(), description).ratio())
            if overlap >= max(2, len(query_tokens) // 2 + 1) and similarity >= 0.6:
                return str(ticker).upper()
        return None


@lru_cache(maxsize=1)
def get_polygon_client() -> PolygonClient:
    return PolygonClient()


def normalize_weight(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        weight = float(value)
    except (TypeError, ValueError):
        return None
    if weight > 1:
        weight = weight / 100.0
    return weight
