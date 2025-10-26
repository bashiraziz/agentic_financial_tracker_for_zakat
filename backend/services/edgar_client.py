from __future__ import annotations

import os
from datetime import date
from functools import lru_cache
from typing import Dict, Iterable, List, Optional, Tuple

import httpx

TICKER_MAP_URL = "https://www.sec.gov/include/ticker.txt"
MUTUAL_FUND_MAP_URL = "https://www.sec.gov/files/company_tickers_mf.json"
COMPANY_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"

USD_UNITS: Tuple[str, ...] = (
    "USD",
    "USDm",
    "USDmm",
    "USD$",
    "USDth",
    "USDThousands",
    "USDmillions",
    "USDMillions",
)
SHARE_UNITS: Tuple[str, ...] = (
    "shares",
    "Shares",
    "SHARES",
    "sharesOutstanding",
)

UNIT_MULTIPLIERS: Dict[str, float] = {
    "USD": 1.0,
    "USD$": 1.0,
    "USDm": 1_000_000.0,
    "USDmm": 1_000_000.0,
    "USDmillions": 1_000_000.0,
    "USDMillions": 1_000_000.0,
    "USDth": 1_000.0,
    "USDThousands": 1_000.0,
}


def _normalize_cik(cik: str) -> str:
    try:
        return f"{int(cik):010d}"
    except ValueError:
        return cik.zfill(10)


class EdgarClient:
    """Client for SEC EDGAR endpoints with simple caching."""

    def __init__(self, user_agent: Optional[str] = None) -> None:
        ua = user_agent or os.getenv("SEC_USER_AGENT")
        if not ua:
            raise RuntimeError(
                "SEC_USER_AGENT environment variable is required. "
                "Set it to something like 'MyApp/0.1 (your-email@example.com)'."
            )
        headers = {
            "User-Agent": ua,
            "Accept-Encoding": "gzip, deflate",
        }
        self._client = httpx.Client(timeout=20.0, headers=headers)
        self._ticker_map: Optional[Dict[str, str]] = None
        self._mutual_fund_map: Optional[Dict[str, Dict[str, str]]] = None
        self._facts_cache: Dict[str, Optional[Dict[str, object]]] = {}
        self._submissions_cache: Dict[str, Optional[Dict[str, object]]] = {}

    def close(self) -> None:
        self._client.close()

    def _load_ticker_map(self) -> Dict[str, str]:
        if self._ticker_map is None:
            response = self._client.get(TICKER_MAP_URL)
            response.raise_for_status()
            mapping: Dict[str, str] = {}
            for line in response.text.splitlines():
                sanitized = line.strip()
                if not sanitized:
                    continue
                if "|" in sanitized:
                    ticker, cik = sanitized.split("|", 1)
                elif "\t" in sanitized:
                    ticker, cik = sanitized.split("\t", 1)
                else:
                    parts = sanitized.split()
                    if len(parts) != 2:
                        continue
                    ticker, cik = parts
                if ticker and cik:
                    mapping[ticker.strip().upper()] = _normalize_cik(cik.strip())
            self._ticker_map = mapping
        return self._ticker_map

    def _load_mutual_fund_map(self) -> Dict[str, Dict[str, str]]:
        if self._mutual_fund_map is None:
            response = self._client.get(MUTUAL_FUND_MAP_URL)
            response.raise_for_status()
            payload = response.json()
            fields = payload.get("fields", [])
            data = payload.get("data", [])

            index_map: Dict[str, int] = {}
            for idx, field in enumerate(fields):
                index_map[field] = idx

            required = {"symbol", "cik"}
            mapping: Dict[str, Dict[str, str]] = {}
            if required.issubset(index_map):
                for row in data:
                    if not isinstance(row, list):
                        continue
                    try:
                        symbol = str(row[index_map["symbol"]]).upper().strip()
                        cik_value = _normalize_cik(str(row[index_map["cik"]]))
                    except (KeyError, ValueError, IndexError):
                        continue
                    if not symbol:
                        continue
                    entry: Dict[str, str] = {"cik": cik_value}
                    if "seriesId" in index_map:
                        series_val = row[index_map["seriesId"]]
                        if series_val:
                            entry["series_id"] = str(series_val).strip()
                    if "classId" in index_map:
                        class_val = row[index_map["classId"]]
                        if class_val:
                            entry["class_id"] = str(class_val).strip()
                    mapping[symbol] = entry
            self._mutual_fund_map = mapping
        return self._mutual_fund_map

    def get_cik(self, ticker: str) -> Optional[str]:
        normalized = ticker.upper().strip()
        mapping = self._load_ticker_map()
        cik = mapping.get(normalized)
        if cik:
            return cik
        mutual_map = self._load_mutual_fund_map()
        metadata = mutual_map.get(normalized)
        if metadata:
            return metadata.get("cik")
        return None

    def get_mutual_fund_metadata(self, ticker: str) -> Optional[Dict[str, str]]:
        normalized = ticker.upper().strip()
        mapping = self._load_mutual_fund_map()
        entry = mapping.get(normalized)
        if entry:
            return entry.copy()
        return None

    def _request_json(self, url: str) -> Optional[Dict[str, object]]:
        response = self._client.get(url)
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    def get_company_facts(self, cik: str) -> Optional[Dict[str, object]]:
        cik_norm = _normalize_cik(cik)
        if cik_norm not in self._facts_cache:
            url = COMPANY_FACTS_URL.format(cik=cik_norm)
            self._facts_cache[cik_norm] = self._request_json(url)
        return self._facts_cache[cik_norm]

    def get_company_submissions(self, cik: str) -> Optional[Dict[str, object]]:
        cik_norm = _normalize_cik(cik)
        if cik_norm not in self._submissions_cache:
            url = SUBMISSIONS_URL.format(cik=cik_norm)
            self._submissions_cache[cik_norm] = self._request_json(url)
        return self._submissions_cache[cik_norm]


@lru_cache(maxsize=1)
def get_edgar_client() -> EdgarClient:
    return EdgarClient()


def _parse_fact_date(entry: Dict[str, object]) -> Optional[date]:
    for key in ("end", "instant", "report", "date"):
        value = entry.get(key)
        if isinstance(value, str):
            try:
                return date.fromisoformat(value)
            except ValueError:
                continue
    return None


def _select_entries(
    units: Dict[str, List[Dict[str, object]]],
    preferred_units: Iterable[str],
) -> Tuple[Optional[str], Optional[List[Dict[str, object]]]]:
    for unit in preferred_units:
        entries = units.get(unit)
        if entries:
            return unit, entries
    for unit, entries in units.items():
        if entries:
            return unit, entries
    return None, None


def extract_fact_value(
    facts_payload: Dict[str, object],
    concept_candidates: Iterable[str],
    unit_candidates: Iterable[str],
    as_of: date,
) -> Tuple[Optional[float], Optional[date]]:
    facts = facts_payload.get("facts", {})
    us_gaap = facts.get("us-gaap", {})
    for concept in concept_candidates:
        fact = us_gaap.get(concept)
        if not isinstance(fact, dict):
            continue
        if "units" not in fact:
            continue
        unit_key, entries = _select_entries(fact["units"], unit_candidates)
        if not entries:
            continue
        selected_entry: Optional[Dict[str, object]] = None
        candidates: List[Tuple[date, Dict[str, object]]] = []
        for entry in entries:
            fact_date = _parse_fact_date(entry)
            if not fact_date:
                continue
            if fact_date <= as_of:
                candidates.append((fact_date, entry))
        if candidates:
            candidates.sort(key=lambda item: item[0], reverse=True)
            selected_entry = candidates[0][1]
        elif entries:
            selected_entry = entries[0]

        if not selected_entry:
            continue
        value = selected_entry.get("val")
        if value is None:
            continue
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            continue
        multiplier = UNIT_MULTIPLIERS.get(unit_key or "", 1.0)
        fact_date = _parse_fact_date(selected_entry)
        return numeric * multiplier, fact_date
    return None, None


def extract_company_name(submissions_payload: Optional[Dict[str, object]]) -> Optional[str]:
    if not submissions_payload:
        return None
    name = submissions_payload.get("name")
    if isinstance(name, str):
        return name
    return None
