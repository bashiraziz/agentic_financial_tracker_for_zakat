from __future__ import annotations

import os
import threading
import time
from collections import deque
from datetime import date, datetime, timedelta
from functools import lru_cache
from typing import Any, Deque, Dict, Optional, Tuple

import httpx


class AlphaVantageError(RuntimeError):
    """Raised when Alpha Vantage responds with an error."""


class AlphaVantageRateLimitError(AlphaVantageError):
    """Raised when Alpha Vantage indicates the free-tier rate limit has been exceeded."""


class AlphaVantageClient:
    """Minimal Alpha Vantage client for fetching daily price data."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        *,
        timeout: float = 10.0,
        max_calls_per_minute: int = 5,
        max_retries: int = 3,
        retry_delay_seconds: float = 16.0,
    ) -> None:
        self.api_key = api_key or os.getenv("ALPHA_VANTAGE_API_KEY")
        if not self.api_key:
            raise RuntimeError(
                "ALPHA_VANTAGE_API_KEY is missing. Set it in your environment or .env file."
            )
        self.base_url = base_url or os.getenv("ALPHA_VANTAGE_BASE_URL", "https://www.alphavantage.co")
        self._client = httpx.Client(base_url=self.base_url, timeout=timeout)
        self._lock = threading.Lock()
        self._call_times: Deque[float] = deque()
        self._max_calls_per_minute = max_calls_per_minute
        self._max_retries = max(1, max_retries)
        self._retry_delay_seconds = max(1.0, retry_delay_seconds)

    def close(self) -> None:
        self._client.close()

    def _throttle(self) -> None:
        """Respect Alpha Vantage's published 5 calls / minute limit."""
        window_seconds = 60.0
        while True:
            with self._lock:
                now = time.monotonic()
                while self._call_times and now - self._call_times[0] >= window_seconds:
                    self._call_times.popleft()
                if len(self._call_times) < self._max_calls_per_minute:
                    self._call_times.append(now)
                    return
                earliest = self._call_times[0]
                delay = window_seconds - (now - earliest) + 0.01
            time.sleep(max(delay, 0.01))

    def _get(self, params: Dict[str, Any]) -> Dict[str, Any]:
        for attempt in range(self._max_retries):
            self._throttle()
            query = params.copy()
            query["apikey"] = self.api_key
            response = self._client.get("/query", params=query)
            response.raise_for_status()
            payload = response.json()

            error_message = payload.get("Error Message")
            if error_message:
                raise AlphaVantageError(error_message)

            note = payload.get("Note")
            if note:
                normalized = note.lower()
                rate_limited = "standard api call frequency" in normalized or "thank you for using alpha vantage" in normalized
                if rate_limited and attempt < self._max_retries - 1:
                    time.sleep(self._retry_delay_seconds)
                    continue
                if rate_limited:
                    raise AlphaVantageRateLimitError(note)
                raise AlphaVantageError(note)

            return payload

        raise AlphaVantageError("Alpha Vantage request retries exhausted.")

    def get_daily_close(
        self,
        symbol: str,
        as_of: date,
        lookback_days: int = 120,
    ) -> Tuple[Optional[float], Optional[date]]:
        """Fetch the most recent close on or before the requested date."""
        start_date = as_of - timedelta(days=max(lookback_days, 0))
        outputsize = "full" if lookback_days > 100 else "compact"
        payload = self._get(
            {
                "function": "TIME_SERIES_DAILY_ADJUSTED",
                "symbol": symbol.upper(),
                "outputsize": outputsize,
            }
        )

        time_series = payload.get("Time Series (Daily)")
        if not isinstance(time_series, dict):
            return None, None

        latest_date: Optional[date] = None
        latest_close: Optional[float] = None

        for date_str, datapoint in sorted(time_series.items(), reverse=True):
            try:
                entry_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                continue
            if entry_date > as_of or entry_date < start_date:
                continue
            close_str = (
                datapoint.get("5. adjusted close")
                or datapoint.get("4. close")
                or datapoint.get("4. Close")
            )
            if close_str is None:
                continue
            try:
                latest_close = float(close_str)
            except (TypeError, ValueError):
                continue
            latest_date = entry_date
            break

        return latest_close, latest_date


@lru_cache(maxsize=1)
def get_alpha_vantage_client() -> AlphaVantageClient:
    return AlphaVantageClient()
