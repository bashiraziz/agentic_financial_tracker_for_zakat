"""Fetch and cache S&P 500 / NASDAQ 100 / Dow 30 constituent lists from Wikipedia."""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

import httpx
import pandas as pd

CACHE_DIR = Path(__file__).parent.parent / "data" / "cache"
CACHE_TTL_DAYS = 7

INDEX_CONFIG: Dict[str, Dict] = {
    "SP500": {
        "name": "S&P 500",
        "url": "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
        "ticker_col_candidates": ["Symbol", "Ticker", "Ticker symbol"],
        "name_col_candidates": ["Security", "Company", "Name"],
        "sector_col_candidates": ["GICS Sector", "Sector", "GICS sector"],
        "min_rows": 20,
    },
    "NASDAQ100": {
        "name": "NASDAQ 100",
        "url": "https://en.wikipedia.org/wiki/Nasdaq-100",
        "ticker_col_candidates": ["Ticker", "Symbol", "Ticker symbol"],
        "name_col_candidates": ["Company", "Security", "Name"],
        "sector_col_candidates": ["GICS Sector", "Sector", "Industry"],
        "min_rows": 20,
    },
    "DOW30": {
        "name": "Dow 30",
        "url": "https://en.wikipedia.org/wiki/Dow_Jones_Industrial_Average",
        "ticker_col_candidates": ["Symbol", "Ticker", "Ticker symbol"],
        "name_col_candidates": ["Company", "Name", "Security"],
        "sector_col_candidates": ["Industry", "GICS Sector", "Sector"],
        "min_rows": 20,
    },
}


def _cache_path(index_id: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / f"constituents_{index_id}.json"


def _load_cache(index_id: str) -> Optional[List[Dict]]:
    path = _cache_path(index_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        cached_at_str = data.get("cached_at", "")
        if cached_at_str:
            cached_at = datetime.fromisoformat(cached_at_str)
            if datetime.utcnow() - cached_at < timedelta(days=CACHE_TTL_DAYS):
                return data.get("constituents", [])
    except Exception:  # noqa: BLE001
        pass
    return None


def _save_cache(index_id: str, constituents: List[Dict]) -> None:
    path = _cache_path(index_id)
    try:
        payload = {
            "cached_at": datetime.utcnow().isoformat(),
            "constituents": constituents,
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass


def _find_column(df_columns: List[str], candidates: List[str]) -> Optional[str]:
    """Return the first candidate that matches a DataFrame column (case-insensitive)."""
    lower_cols = {c.lower(): c for c in df_columns}
    for cand in candidates:
        match = lower_cols.get(cand.lower())
        if match:
            return match
    return None


def _parse_tables(html: str, config: Dict) -> List[Dict]:
    """Parse all tables from HTML and find the best matching one."""
    try:
        tables = pd.read_html(html, flavor="lxml")
    except Exception:
        tables = pd.read_html(html)

    min_rows = config.get("min_rows", 20)
    ticker_cands = config["ticker_col_candidates"]
    name_cands = config["name_col_candidates"]
    sector_cands = config["sector_col_candidates"]

    for df in tables:
        if len(df) < min_rows:
            continue
        cols = list(df.columns.astype(str))
        ticker_col = _find_column(cols, ticker_cands)
        name_col = _find_column(cols, name_cands)
        if not ticker_col or not name_col:
            continue
        sector_col = _find_column(cols, sector_cands)

        constituents: List[Dict] = []
        for _, row in df.iterrows():
            ticker = str(row[ticker_col]).strip().upper()
            if not ticker or ticker == "NAN" or ticker == "SYMBOL":
                continue
            # Strip any footnote markers (e.g. AAPL[1])
            ticker = ticker.split("[")[0].strip()
            if not ticker:
                continue
            name = str(row[name_col]).strip()
            sector = str(row[sector_col]).strip() if sector_col else "Unknown"
            if sector in ("NAN", "nan"):
                sector = "Unknown"
            constituents.append({
                "ticker": ticker,
                "name": name,
                "sector": sector,
            })

        if len(constituents) >= min_rows:
            return constituents

    return []


def fetch_constituents(index_id: str) -> List[Dict]:
    """Return [{ticker, name, sector}, ...] for the given index.

    Results are cached on disk for CACHE_TTL_DAYS days.
    """
    index_id = index_id.upper()
    if index_id not in INDEX_CONFIG:
        raise ValueError(f"Unknown index_id: {index_id!r}. Valid: {list(INDEX_CONFIG)}")

    cached = _load_cache(index_id)
    if cached is not None:
        return cached

    config = INDEX_CONFIG[index_id]
    ua = os.getenv("SEC_USER_AGENT", "ZakatTracker/1.0 (contact@example.com)")
    headers = {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml",
    }
    with httpx.Client(timeout=30.0, headers=headers, follow_redirects=True) as client:
        response = client.get(config["url"])
        response.raise_for_status()
        html = response.text

    constituents = _parse_tables(html, config)
    if not constituents:
        raise RuntimeError(
            f"Could not parse constituent table for {index_id} from Wikipedia. "
            "Table structure may have changed."
        )

    _save_cache(index_id, constituents)
    return constituents


def get_sectors(index_id: str) -> List[str]:
    """Return sorted unique sector list for the given index."""
    constituents = fetch_constituents(index_id)
    sectors = sorted({c["sector"] for c in constituents if c.get("sector")})
    return sectors
