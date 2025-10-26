# Re-export valuation utilities for easier imports
from .valuation import analyze_portfolio, compute_company_metrics


def clear_service_caches() -> None:
    """Reset cached service clients and computed metrics."""
    compute_company_metrics.cache_clear()

    # Alpha Vantage client
    from .alpha_vantage_client import get_alpha_vantage_client

    try:
        alpha_client = get_alpha_vantage_client()
    except Exception:  # noqa: BLE001
        alpha_client = None
    else:
        try:
            alpha_client.close()
        except Exception:  # noqa: BLE001
            pass
    get_alpha_vantage_client.cache_clear()

    # Polygon client and its method caches
    from .polygon_client import get_polygon_client

    try:
        polygon_client = get_polygon_client()
    except Exception:  # noqa: BLE001
        polygon_client = None
    else:
        try:
            polygon_client.get_daily_close.cache_clear()
            polygon_client.get_etf_holdings.cache_clear()
            polygon_client.get_ticker_details.cache_clear()
            polygon_client.search_tickers.cache_clear()
        except Exception:  # noqa: BLE001
            pass
        try:
            polygon_client.close()
        except Exception:  # noqa: BLE001
            pass
    get_polygon_client.cache_clear()

    # Edgar client and related caches
    from .edgar_client import get_edgar_client

    try:
        edgar_client = get_edgar_client()
    except Exception:  # noqa: BLE001
        edgar_client = None
    else:
        try:
            edgar_client._facts_cache.clear()  # type: ignore[attr-defined]
            edgar_client._submissions_cache.clear()  # type: ignore[attr-defined]
            edgar_client._ticker_map = None  # type: ignore[attr-defined]
            edgar_client._mutual_fund_map = None  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass
        try:
            edgar_client.close()
        except Exception:  # noqa: BLE001
            pass
    get_edgar_client.cache_clear()

    # SEC mapping cache (depends on Edgar client)
    from .sec_mapping import _load_mapping

    try:
        _load_mapping.cache_clear()
    except Exception:  # noqa: BLE001
        pass


__all__ = ["analyze_portfolio", "compute_company_metrics", "clear_service_caches"]
