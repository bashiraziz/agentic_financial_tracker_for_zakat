"""Async debt-ratio screening for index constituents using SEC EDGAR."""
from __future__ import annotations

import asyncio
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from backend.services.edgar_client import (
    USD_UNITS,
    extract_fact_value,
    get_edgar_client,
)

CACHE_DIR = Path(__file__).parent.parent / "data" / "cache"
EDGAR_CACHE_TTL_DAYS = 90

# GICS sectors considered "financial sector" for Islamic finance screening
FINANCIAL_SECTORS = frozenset(
    {
        "Financials",
        "Financial Services",
        "Banks",
        "Insurance",
        "Diversified Financials",
        "Capital Markets",
        "Consumer Finance",
        "Thrifts & Mortgage Finance",
        "Real Estate",  # REITs are structurally leveraged
    }
)

# Interest-bearing debt concepts in priority order (per spec)
DEBT_CONCEPTS_PRIMARY: List[str] = [
    "LongTermDebtNoncurrent",
    "LongTermDebtCurrent",
    "ShortTermBorrowings",
]
DEBT_CONCEPTS_COMMERCIAL_PAPER = "CommercialPaper"

DEBT_CONCEPTS_FALLBACK_LT: List[str] = ["LongTermDebt"]
DEBT_CONCEPTS_FALLBACK_ST: List[str] = ["ShortTermBorrowings"]
DEBT_CONCEPTS_COMBINED: List[str] = ["DebtLongtermAndShorttermCombinedAmount"]

TOTAL_ASSETS_CONCEPTS: List[str] = ["Assets"]


def _facts_cache_path(cik: str, as_of: date) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / f"debt_facts_{cik}_{as_of.isoformat()}.json"


def _load_facts_cache(cik: str, as_of: date) -> Optional[Dict]:
    path = _facts_cache_path(cik, as_of)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        cached_at_str = data.get("cached_at", "")
        if cached_at_str:
            cached_at = datetime.fromisoformat(cached_at_str)
            if datetime.utcnow() - cached_at < timedelta(days=EDGAR_CACHE_TTL_DAYS):
                return data.get("facts")
    except Exception:  # noqa: BLE001
        pass
    return None


def _save_facts_cache(cik: str, as_of: date, facts: Dict) -> None:
    path = _facts_cache_path(cik, as_of)
    try:
        payload = {
            "cached_at": datetime.utcnow().isoformat(),
            "facts": facts,
        }
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass


def _extract_interest_bearing_debt(
    facts: Dict,
    as_of: date,
) -> Tuple[Optional[float], str]:
    """Extract interest-bearing debt using priority cascade per spec.

    Returns (value_in_usd, strategy_label).
    """
    units = list(USD_UNITS)

    # Strategy 1: sum LongTermDebtNoncurrent + LongTermDebtCurrent + ShortTermBorrowings
    lt_noncurrent, _ = extract_fact_value(facts, ["LongTermDebtNoncurrent"], units, as_of)
    lt_current, _ = extract_fact_value(facts, ["LongTermDebtCurrent"], units, as_of)
    st_borrow, _ = extract_fact_value(facts, ["ShortTermBorrowings"], units, as_of)

    if lt_noncurrent is not None or lt_current is not None or st_borrow is not None:
        total = (lt_noncurrent or 0.0) + (lt_current or 0.0) + (st_borrow or 0.0)
        return total, "primary"

    # CommercialPaper as substitute for ShortTermBorrowings when missing
    cp, _ = extract_fact_value(facts, [DEBT_CONCEPTS_COMMERCIAL_PAPER], units, as_of)
    if lt_noncurrent is not None or lt_current is not None or cp is not None:
        total = (lt_noncurrent or 0.0) + (lt_current or 0.0) + (cp or 0.0)
        return total, "primary_cp"

    # Strategy 2: LongTermDebt + ShortTermBorrowings
    lt_debt, _ = extract_fact_value(facts, DEBT_CONCEPTS_FALLBACK_LT, units, as_of)
    st_borrow2, _ = extract_fact_value(facts, DEBT_CONCEPTS_FALLBACK_ST, units, as_of)
    if lt_debt is not None or st_borrow2 is not None:
        total = (lt_debt or 0.0) + (st_borrow2 or 0.0)
        return total, "fallback_lt_st"

    # Strategy 3: combined amount concept
    combined, _ = extract_fact_value(facts, DEBT_CONCEPTS_COMBINED, units, as_of)
    if combined is not None:
        return combined, "combined"

    return None, "none"


def _screen_one_sync(ticker: str, name: str, sector: str, as_of: date) -> Dict:
    """Synchronous function to screen a single company. Run in thread pool."""
    is_financial = sector in FINANCIAL_SECTORS
    result: Dict = {
        "ticker": ticker,
        "name": name,
        "sector": sector,
        "total_assets": None,
        "interest_bearing_debt": None,
        "ratio": None,
        "is_financial_sector": is_financial,
        "error": None,
    }

    try:
        client = get_edgar_client()
        cik = client.get_cik(ticker)
        if not cik:
            result["error"] = f"CIK not found for {ticker}"
            return result

        # Try EDGAR facts cache first
        facts = _load_facts_cache(cik, as_of)
        if facts is None:
            facts = client.get_company_facts(cik)
            if facts is not None:
                _save_facts_cache(cik, as_of, facts)

        if not facts:
            result["error"] = "No EDGAR facts available"
            return result

        units = list(USD_UNITS)
        total_assets, _ = extract_fact_value(facts, TOTAL_ASSETS_CONCEPTS, units, as_of)
        debt, _strategy = _extract_interest_bearing_debt(facts, as_of)

        result["total_assets"] = total_assets
        result["interest_bearing_debt"] = debt

        if total_assets and total_assets > 0 and debt is not None:
            result["ratio"] = debt / total_assets
        elif debt is None:
            result["error"] = "Interest-bearing debt data unavailable"
        elif not total_assets:
            result["error"] = "Total assets data unavailable"

    except Exception as exc:  # noqa: BLE001
        result["error"] = str(exc)

    return result


async def screen_companies(
    tickers_meta: List[Dict],
    as_of: date,
    semaphore: asyncio.Semaphore,
) -> List[Dict]:
    """Concurrently screen companies for interest-bearing debt / total assets ratio.

    Each item in tickers_meta must have: ticker, name, sector.
    Returns list of result dicts matching CompanyDebtResult schema fields.
    """

    async def _fetch_one(meta: Dict) -> Dict:
        async with semaphore:
            return await asyncio.to_thread(
                _screen_one_sync,
                meta["ticker"],
                meta.get("name", meta["ticker"]),
                meta.get("sector", "Unknown"),
                as_of,
            )

    tasks = [_fetch_one(meta) for meta in tickers_meta]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    output: List[Dict] = []
    for meta, res in zip(tickers_meta, results):
        if isinstance(res, Exception):
            output.append(
                {
                    "ticker": meta["ticker"],
                    "name": meta.get("name", meta["ticker"]),
                    "sector": meta.get("sector", "Unknown"),
                    "total_assets": None,
                    "interest_bearing_debt": None,
                    "ratio": None,
                    "is_financial_sector": meta.get("sector", "") in FINANCIAL_SECTORS,
                    "error": str(res),
                }
            )
        else:
            output.append(res)  # type: ignore[arg-type]

    return output
