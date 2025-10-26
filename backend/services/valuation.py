from __future__ import annotations
import asyncio
from dataclasses import dataclass
from functools import lru_cache
from datetime import date, datetime, timedelta
from typing import Dict, Iterable, List, Optional, Tuple

import csv
import io

import httpx

from backend.schemas import (
    CompanyInput,
    CompanyValuation,
    FundHoldingValuation,
    FundInput,
    FundValuation,
    ValuationRequest,
    ValuationResponse,
)
from backend.services.edgar_client import (
    SHARE_UNITS,
    USD_UNITS,
    EdgarClient,
    extract_company_name,
    extract_fact_value,
    get_edgar_client,
)
from backend.services.alpha_vantage_client import (
    AlphaVantageError,
    AlphaVantageRateLimitError,
    get_alpha_vantage_client,
)
from backend.services.sec_holdings import FundHoldingsResult, get_sec_holdings, SecHoldingsError
from backend.services.polygon_client import get_polygon_client


CASH_CONCEPTS: Tuple[str, ...] = (
    "CashAndCashEquivalentsAtCarryingValue",
    "CashAndCashEquivalentsIncludingRestrictedCash",
    "CashAndShortTermInvestments",
)
RECEIVABLE_CONCEPTS: Tuple[str, ...] = (
    "AccountsReceivableNetCurrent",
    "AccountsReceivableTradeNetCurrent",
    "ReceivablesNetCurrent",
)
INVENTORY_CONCEPTS: Tuple[str, ...] = (
    "InventoryNet",
    "InventoryFinishedGoods",
    "InventoryRawMaterials",
)
SHARE_CONCEPTS: Tuple[str, ...] = (
    "EntityCommonStockSharesOutstanding",
    "CommonStockSharesOutstanding",
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    "WeightedAverageNumberOfSharesOutstandingBasic",
)

SHARE_STALE_DAYS = 540

@dataclass
class CompanyMetrics:
    ticker: str
    company_name: Optional[str]
    currency: Optional[str]
    data_date: Optional[date]
    price_date: Optional[date]
    cash_and_equivalents: Optional[float]
    receivables: Optional[float]
    inventories: Optional[float]
    market_price: Optional[float]
    shares_outstanding: Optional[float]
    cri_per_share: Optional[float]
    cri_to_market_price_ratio: Optional[float]
    warnings: List[str]


class FinancialDataUnavailable(Exception):
    """Raised when required financial data cannot be retrieved."""


def _fetch_market_price(ticker_symbol: str, as_of_date: date) -> Tuple[Optional[float], Optional[date], List[str]]:
    warnings: List[str] = []
    price_value: Optional[float] = None
    price_date: Optional[date] = None
    client = get_alpha_vantage_client()
    try:
        close_value, close_date = client.get_daily_close(
            ticker_symbol,
            as_of_date,
            lookback_days=120,
        )
        if close_value is not None and close_date is not None:
            price_value = close_value
            price_date = close_date
        else:
            warnings.append("No price data available on or before the requested date.")
    except AlphaVantageRateLimitError as exc:
        warnings.append(f"Alpha Vantage rate limit reached even after retries: {exc}")
    except AlphaVantageError as exc:
        warnings.append(f"Alpha Vantage error: {exc}")
    except httpx.HTTPError as exc:
        warnings.append(f"Alpha Vantage request failed: {exc}")
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"Price lookup failed via Alpha Vantage: {exc}")

    if price_value is None or price_date is None:
        warnings.append("Falling back to Polygon aggregates for price data.")
        try:
            polygon_client = get_polygon_client()
            fallback_value, fallback_date = polygon_client.get_daily_close(
                ticker_symbol,
                as_of_date,
                lookback_days=60,
            )
            if fallback_value is not None and fallback_date is not None:
                price_value = fallback_value
                price_date = fallback_date
            else:
                warnings.append("Polygon aggregates did not provide price data on or before the requested date.")
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"Polygon fallback failed: {exc}")

    return price_value, price_date, warnings


@lru_cache(maxsize=512)
def compute_company_metrics(ticker_symbol: str, as_of_date: date) -> CompanyMetrics:
    edgar: EdgarClient = get_edgar_client()
    ticker_symbol = ticker_symbol.upper().strip()
    warnings: List[str] = []

    cik = edgar.get_cik(ticker_symbol)
    if not cik:
        raise FinancialDataUnavailable("SEC could not map ticker to a CIK.")

    facts_payload = edgar.get_company_facts(cik)
    if not facts_payload:
        raise FinancialDataUnavailable("No SEC company facts available for this ticker.")

    cash, cash_date = extract_fact_value(facts_payload, CASH_CONCEPTS, USD_UNITS, as_of_date)
    receivables, receivables_date = extract_fact_value(
        facts_payload, RECEIVABLE_CONCEPTS, USD_UNITS, as_of_date
    )
    inventories, inventories_date = extract_fact_value(
        facts_payload, INVENTORY_CONCEPTS, USD_UNITS, as_of_date
    )
    shares, shares_date = extract_fact_value(facts_payload, SHARE_CONCEPTS, SHARE_UNITS, as_of_date)

    for label, value in (
        ("Cash and equivalents", cash),
        ("Receivables", receivables),
        ("Inventories", inventories),
    ):
        if value is None:
            warnings.append(f"{label} unavailable in SEC filings.")

    sec_shares_stale = False
    if shares_date:
        try:
            sec_shares_stale = (as_of_date - shares_date) > timedelta(days=SHARE_STALE_DAYS)
        except Exception:
            sec_shares_stale = False

    polygon_share_used = False
    if shares is None or sec_shares_stale:
        if sec_shares_stale and shares is not None:
            warnings.append(
                "Shares outstanding from SEC filings appear stale; attempting Polygon reference data."
            )
        try:
            polygon_details = get_polygon_client().get_ticker_details(ticker_symbol)
        except Exception as exc:  # noqa: BLE001
            polygon_details = None
            warnings.append(f"Polygon shares fallback failed: {exc}")
        fallback_shares: Optional[float] = None
        if polygon_details and isinstance(polygon_details, dict):
            for key in ("weighted_shares_outstanding", "share_class_shares_outstanding"):
                value = polygon_details.get(key)
                if value is not None:
                    try:
                        fallback_shares = float(value)
                    except (TypeError, ValueError):
                        continue
                    break
        if fallback_shares is not None:
            shares = fallback_shares
            shares_date = None
            polygon_share_used = True
            warnings.append("Shares outstanding sourced from Polygon reference data.")
        elif sec_shares_stale:
            shares = None
            warnings.append("SEC-reported shares were stale and Polygon reference data was unavailable.")

    if shares is None:
        warnings.append("Shares outstanding unavailable; CRI per share not computed.")

    company_name = extract_company_name(edgar.get_company_submissions(cik))
    currency = "USD"

    market_price, price_date, price_warnings = _fetch_market_price(ticker_symbol, as_of_date)
    warnings.extend(price_warnings)

    cri_per_share: Optional[float] = None
    cri_ratio: Optional[float] = None
    numerator = sum(metric for metric in (cash, receivables, inventories) if metric is not None)

    if shares and shares > 0:
        cri_per_share = numerator / shares
        if market_price and market_price > 0:
            cri_ratio = cri_per_share / market_price
    else:
        warnings.append("Shares outstanding unavailable; CRI per share not computed.")

    data_date_candidates = [date for date in (cash_date, receivables_date, inventories_date) if date]
    data_date = max(data_date_candidates) if data_date_candidates else None

    return CompanyMetrics(
        ticker=ticker_symbol,
        company_name=company_name,
        currency=currency,
        data_date=data_date,
        price_date=price_date,
        cash_and_equivalents=cash,
        receivables=receivables,
        inventories=inventories,
        market_price=market_price,
        shares_outstanding=shares,
        cri_per_share=cri_per_share,
        cri_to_market_price_ratio=cri_ratio,
        warnings=warnings,
    )


def _company_metrics_to_schema(metrics: CompanyMetrics, shares: Optional[float] = None) -> CompanyValuation:
    return CompanyValuation(
        ticker=metrics.ticker,
        company_name=metrics.company_name,
        currency=metrics.currency,
        data_date=metrics.data_date,
        price_date=metrics.price_date,
        cash_and_equivalents=metrics.cash_and_equivalents,
        receivables=metrics.receivables,
        inventories=metrics.inventories,
        market_price=metrics.market_price,
        shares_outstanding=metrics.shares_outstanding,
        cri_per_share=metrics.cri_per_share,
        cri_to_market_price_ratio=metrics.cri_to_market_price_ratio,
        shares=shares,
        warnings=metrics.warnings,
    )


async def _gather_company_metrics(
    companies: List[CompanyInput], as_of_date: date
) -> List[CompanyValuation]:
    semaphore = asyncio.Semaphore(10)

    async def _compute(company: CompanyInput) -> CompanyValuation:
        async with semaphore:
            try:
                metrics: CompanyMetrics = await asyncio.to_thread(
                    compute_company_metrics,
                    company.ticker,
                    as_of_date,
                )
                return _company_metrics_to_schema(metrics, company.shares)
            except FinancialDataUnavailable as exc:
                return CompanyValuation(
                    ticker=company.ticker.upper().strip(),
                    shares=company.shares,
                    warnings=[str(exc)],
                )
            except Exception as exc:  # noqa: BLE001
                return CompanyValuation(
                    ticker=company.ticker.upper().strip(),
                    shares=company.shares,
                    warnings=[f"Unexpected error: {exc}"],
                )

    tasks = [_compute(company) for company in companies]
    return list(await asyncio.gather(*tasks))


async def _gather_fund_metrics(
    funds: List[FundInput], as_of_date: date
) -> List[FundValuation]:
    edgar = get_edgar_client()
    fund_results: List[FundValuation] = []

    for fund in funds:
        ticker_symbol = fund.ticker.upper().strip()
        warnings: List[str] = []
        holdings_output: List[FundHoldingValuation] = []

        fund_name: Optional[str] = None
        currency: Optional[str] = "USD"
        try:
            cik = edgar.get_cik(ticker_symbol)
            if cik:
                submissions = edgar.get_company_submissions(cik) or {}
                fund_name = submissions.get("name")
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"SEC fund profile lookup failed: {exc}")

        fund_price: Optional[float] = None
        fund_price_date: Optional[date] = None
        price_value, price_date, price_warnings = _fetch_market_price(ticker_symbol, as_of_date)
        fund_price = price_value
        fund_price_date = price_date
        warnings.extend(price_warnings)

        holdings_data: Optional[FundHoldingsResult] = None
        try:
            holdings_data = get_sec_holdings(ticker_symbol, as_of_date)
        except SecHoldingsError as exc:
            warnings.append(str(exc))
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"SEC holdings lookup failed: {exc}")
        if holdings_data is not None:
            if holdings_data.series_name:
                fund_name = holdings_data.series_name
            elif holdings_data.class_name and not fund_name:
                fund_name = holdings_data.class_name
            holdings_raw = holdings_data.holdings
        else:
            holdings_raw = []

        if not holdings_raw:
            warnings.append("SEC holdings unavailable; fund holdings table will be empty.")

        symbols_to_fetch: Dict[str, CompanyInput] = {}
        for holding in holdings_raw:
            symbol = (holding.get("ticker") or "").upper().strip()
            weight = holding.get("weight")
            if symbol and weight is not None:
                symbols_to_fetch.setdefault(symbol, CompanyInput(ticker=symbol, shares=None))

        metrics_map: Dict[str, CompanyValuation] = {}
        if symbols_to_fetch:
            fetched_metrics = await _gather_company_metrics(list(symbols_to_fetch.values()), as_of_date)
            metrics_map = {valuation.ticker.upper(): valuation for valuation in fetched_metrics}

        weighted_ratio_sum = 0.0
        weight_sum = 0.0

        excluded_holdings: List[str] = []

        for holding in holdings_raw:
            symbol = (holding.get("ticker") or "").upper().strip()
            weight = holding.get("weight")
            holding_name = holding.get("name")
            isin = holding.get("isin")
            cusip = holding.get("cusip")
            holding_warnings: List[str] = []
            company_schema: Optional[CompanyValuation] = None

            if not symbol:
                holding_warnings.append("Ticker unavailable from SEC filings; skipped CRI computation.")
            if weight is None:
                holding_warnings.append("Weight missing from SEC filings.")

            if symbol and weight is not None:
                company_schema = metrics_map.get(symbol)
                if company_schema is None:
                    holding_warnings.append("Unable to compute company metrics for this holding.")
                elif company_schema.cri_to_market_price_ratio is not None:
                    ratio_value = company_schema.cri_to_market_price_ratio
                    if ratio_value > 1.0 and weight < 0.02:
                        holding_warnings.append(
                            "Excluded from aggregate CRI/Price (weight <2% and ratio >100%)."
                        )
                        excluded_holdings.append(
                            f"{symbol or holding_name}: {ratio_value:.2f} ratio, {weight:.2%} weight"
                        )
                    else:
                        weighted_ratio_sum += weight * ratio_value
                        weight_sum += weight
                if company_schema is not None and company_schema.warnings:
                    holding_warnings.extend(company_schema.warnings)

            holdings_output.append(
                FundHoldingValuation(
                    ticker=symbol or None,
                    name=holding_name or symbol or None,
                    isin=isin,
                    cusip=cusip,
                    weight=weight,
                    company=company_schema,
                    warnings=holding_warnings,
                )
            )

        aggregate_ratio: Optional[float] = None
        aggregate_cri_per_share: Optional[float] = None
        if weight_sum > 0:
            aggregate_ratio = weighted_ratio_sum / weight_sum
            if fund_price is not None:
                aggregate_cri_per_share = aggregate_ratio * fund_price
        elif holdings_output:
            warnings.append("Aggregate ratio unavailable due to missing holding weights.")

        if weight_sum and weight_sum < 0.95:
            warnings.append(
                f"Holdings weights cover {weight_sum:.2%} of the fund; results scaled by reported weights."
            )
        if excluded_holdings:
            warnings.append(
                "Excluded low-weight, high-CRI holdings from aggregate calculation: "
                + "; ".join(excluded_holdings)
            )

        fund_results.append(
            FundValuation(
                ticker=ticker_symbol,
                fund_name=fund_name,
                currency=currency,
                market_price=fund_price,
                price_date=fund_price_date,
                aggregate_cri_per_share=aggregate_cri_per_share,
                aggregate_cri_to_market_price_ratio=aggregate_ratio,
                total_weight_covered=weight_sum if weight_sum > 0 else None,
                holdings=holdings_output,
                warnings=warnings,
            )
        )

    return fund_results


async def analyze_portfolio(request: ValuationRequest) -> ValuationResponse:
    portfolio_results, fund_results = await asyncio.gather(
        _gather_company_metrics(request.portfolio, request.as_of_date),
        _gather_fund_metrics(request.funds, request.as_of_date),
    )
    return ValuationResponse(
        generated_at=datetime.utcnow(),
        as_of_date=request.as_of_date,
        portfolio=portfolio_results,
        funds=fund_results,
    )
