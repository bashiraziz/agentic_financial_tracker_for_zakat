from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Dict, Iterable, List, Optional, Tuple
import xml.etree.ElementTree as ET

from backend.services.edgar_client import EdgarClient, get_edgar_client
from backend.services.sec_mapping import lookup_ticker_for_name

SEC_NAMESPACE = {
    "n": "http://www.sec.gov/edgar/nport",
    "com": "http://www.sec.gov/edgar/common",
    "nc": "http://www.sec.gov/edgar/nportcommon",
}


class SecHoldingsError(Exception):
    """Raised when SEC holdings cannot be retrieved."""


@dataclass
class FundHoldingsResult:
    holdings: List[Dict[str, Optional[float]]]
    series_name: Optional[str]
    class_name: Optional[str]


def _collect_nport_filings(
    submissions: Dict[str, object],
    as_of: date,
) -> List[Tuple[str, str]]:
    filings = submissions.get("filings", {})
    recent = filings.get("recent", {})
    forms = recent.get("form", [])
    accession_numbers = recent.get("accessionNumber", [])
    primary_docs = recent.get("primaryDocument", [])
    report_dates = recent.get("reportDate", [])

    dated_candidates: List[Tuple[date, str, str]] = []
    seen: set[Tuple[str, str]] = set()

    for form, accession, primary_doc, report_date in zip(
        forms, accession_numbers, primary_docs, report_dates
    ):
        if not form or not accession or not primary_doc:
            continue
        if not form.upper().startswith("NPORT"):
            continue
        try:
            report_dt = date.fromisoformat(report_date)
        except (TypeError, ValueError):
            report_dt = None
        if report_dt and report_dt <= as_of:
            dated_candidates.append((report_dt, accession, primary_doc))

    results: List[Tuple[str, str]] = []
    if dated_candidates:
        dated_candidates.sort(key=lambda item: item[0], reverse=True)
        for _, accession, primary_doc in dated_candidates:
            key = (accession, primary_doc)
            if key not in seen:
                results.append(key)
                seen.add(key)

    for form, accession, primary_doc in zip(forms, accession_numbers, primary_docs):
        if not form or not accession or not primary_doc:
            continue
        if not form.upper().startswith("NPORT"):
            continue
        key = (accession, primary_doc)
        if key in seen:
            continue
        results.append(key)
        seen.add(key)

    return results


def _select_latest_nport_filing(
    submissions: Dict[str, object], as_of: date
) -> Optional[Tuple[str, str]]:
    candidates = _collect_nport_filings(submissions, as_of)
    if candidates:
        return candidates[0]
    return None


def _extract_edgar_submission(xml_payload: str) -> ET.Element:
    text = xml_payload.strip()
    return ET.fromstring(text)


def _iter_invst_or_sec(root: ET.Element) -> Iterable[ET.Element]:
    return root.findall(".//n:invstOrSec", SEC_NAMESPACE)


def _resolve_weight(invst_sec: ET.Element) -> Optional[float]:
    pct_val = invst_sec.find("n:pctVal", SEC_NAMESPACE)
    if pct_val is None or pct_val.text is None:
        return None
    try:
        value = float(pct_val.text)
    except (TypeError, ValueError):
        return None
    # pctVal is already expressed as a proportion (e.g., 0.3123 for 31.23%)
    return value / 100.0


def _extract_text(invst_sec: ET.Element, tag: str) -> Optional[str]:
    element = invst_sec.find(tag, SEC_NAMESPACE)
    if element is not None and element.text:
        return element.text.strip()
    return None


def _extract_identifier(invst_sec: ET.Element) -> Tuple[Optional[str], Optional[str]]:
    identifiers = invst_sec.find("n:identifiers", SEC_NAMESPACE)
    isin = cusip = None
    if identifiers is not None:
        for child in identifiers:
            tag = child.tag.rsplit("}", 1)[-1]
            value = child.attrib.get("value")
            if not value:
                continue
            if tag.lower() == "isin" and not isin:
                isin = value
            elif tag.lower() == "cusip" and not cusip:
                cusip = value
    if not cusip:
        cusip = _extract_text(invst_sec, "n:cusip")
    return isin, cusip


def _download_edgar_submission(cik: str, accession_number: str) -> str:
    client = get_edgar_client()
    base_cik = f"{int(cik):d}"
    accession_nodashes = accession_number.replace("-", "")
    txt_url = (
        f"https://www.sec.gov/Archives/edgar/data/{base_cik}/{accession_nodashes}/"
        f"{accession_number}.txt"
    )
    response = client._client.get(txt_url)  # type: ignore[attr-defined]
    response.raise_for_status()
    return response.text


def _extract_submission_xml(txt_payload: str) -> str:
    sections = txt_payload.split("<XML>")
    for section in sections[1:]:
        if "</XML>" not in section:
            continue
        candidate = section.split("</XML>", 1)[0].strip()
        if candidate.startswith("<?xml") and "<edgarSubmission" in candidate:
            return candidate
    raise SecHoldingsError("Unable to locate edgarSubmission XML in filing.")

def _filing_matches_target(
    root: ET.Element,
    target_series_id: Optional[str],
    target_class_id: Optional[str],
) -> bool:
    if not target_series_id and not target_class_id:
        return True
    series_ids = {
        elem.text.strip()
        for elem in root.findall(".//n:seriesId", SEC_NAMESPACE)
        if elem.text
    }
    class_ids = {
        elem.text.strip()
        for elem in root.findall(".//n:classId", SEC_NAMESPACE)
        if elem.text
    }
    if target_series_id and target_series_id not in series_ids:
        return False
    if target_class_id and target_class_id not in class_ids:
        return False
    return True


def get_sec_holdings(ticker: str, as_of: date) -> FundHoldingsResult:
    ticker = ticker.upper().strip()
    edgar = get_edgar_client()

    cik = edgar.get_cik(ticker)
    if not cik:
        raise SecHoldingsError("SEC could not map fund ticker to a CIK.")

    submissions = edgar.get_company_submissions(cik)
    if not submissions:
        raise SecHoldingsError("No SEC submissions available for this CIK.")

    metadata = edgar.get_mutual_fund_metadata(ticker)
    target_series_id = metadata.get("series_id") if metadata else None
    target_class_id = metadata.get("class_id") if metadata else None

    candidates = _collect_nport_filings(submissions, as_of)
    if not candidates:
        raise SecHoldingsError("No NPORT filings found for this fund.")

    root: Optional[ET.Element] = None
    last_error: Optional[Exception] = None

    for accession, _ in candidates:
        try:
            txt_payload = _download_edgar_submission(cik, accession)
            xml_payload = _extract_submission_xml(txt_payload)
            candidate_root = _extract_edgar_submission(xml_payload)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            continue
        if _filing_matches_target(candidate_root, target_series_id, target_class_id):
            root = candidate_root
            break

    if root is None:
        if target_series_id or target_class_id:
            raise SecHoldingsError("No NPORT filings matched the requested share class.")
        if last_error:
            raise SecHoldingsError(f"Unable to download SEC holdings: {last_error}") from last_error
        raise SecHoldingsError("No NPORT filings found for this fund.")

    series_name: Optional[str] = None
    class_name: Optional[str] = None
    series_elem = root.find(".//n:seriesName", SEC_NAMESPACE)
    if series_elem is not None and series_elem.text:
        series_name = series_elem.text.strip()
    class_elem = root.find(".//n:className", SEC_NAMESPACE)
    if class_elem is not None and class_elem.text:
        class_name = class_elem.text.strip()

    holdings: List[Dict[str, Optional[float]]] = []
    for invst_sec in _iter_invst_or_sec(root):
        weight = _resolve_weight(invst_sec)
        if weight is None:
            continue

        name = _extract_text(invst_sec, "n:name")
        title = _extract_text(invst_sec, "n:title")
        isin, cusip = _extract_identifier(invst_sec)

        mapped_ticker: Optional[str] = None
        if name or title:
            mapped_ticker = lookup_ticker_for_name((name or title or "").strip())

        holdings.append(
            {
                "ticker": mapped_ticker,
                "weight": weight,
                "name": name or title or mapped_ticker,
                "isin": isin,
                "cusip": cusip,
            }
        )

    return FundHoldingsResult(holdings=holdings, series_name=series_name, class_name=class_name)
