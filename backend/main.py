# FastAPI entrypoint with Agents SDK setup
import asyncio
import contextlib
import os
from datetime import date

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from backend.schemas import (
    CompanyDebtResult,
    DebtScreeningRequest,
    DebtScreeningResponse,
    ValuationRequest,
    ValuationResponse,
)
from backend.services import analyze_portfolio, clear_service_caches

load_dotenv()

app = FastAPI(title="Agentic Financial Tracker",
              docs_url="/docs")

# Allow frontend to talk to backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://agentic-financial-tracker-for-zakat.vercel.app",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Backend is running!"}

@app.post("/valuation", response_model=ValuationResponse)
async def calculate_valuation(request: Request, payload: ValuationRequest) -> ValuationResponse:
    cancel_event = asyncio.Event()

    async def _monitor_disconnect() -> None:
        try:
            while not cancel_event.is_set():
                if await request.is_disconnected():
                    cancel_event.set()
                    break
                await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            pass

    monitor_task = asyncio.create_task(_monitor_disconnect())

    try:
        return await asyncio.wait_for(
            analyze_portfolio(payload, cancel_event=cancel_event),
            timeout=300,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Valuation timed out after 300 seconds.") from exc
    except asyncio.CancelledError as exc:  # noqa: B904
        raise HTTPException(status_code=499, detail="Client closed request.") from exc
    except Exception as exc:  # noqa: BLE001
        # Surface unexpected errors with generic message while logging stacktrace.
        raise HTTPException(status_code=500, detail=f"Valuation failed: {exc}") from exc
    finally:
        cancel_event.set()
        monitor_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await monitor_task


@app.post("/maintenance/clear-cache")
def clear_caches(x_cache_key: str | None = Header(default=None)) -> dict[str, str]:
    expected = os.getenv("CACHE_CLEAR_API_KEY")
    if expected and x_cache_key != expected:
        raise HTTPException(status_code=403, detail="Forbidden.")
    try:
        clear_service_caches()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Cache clearing failed: {exc}") from exc
    return {"status": "ok", "detail": "Service caches cleared."}

@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "Backend is reachable from Vercel"}


# ---------------------------------------------------------------------------
# Debt Screening endpoints
# ---------------------------------------------------------------------------

@app.get("/screening/sectors")
def get_screening_sectors(index_id: str = Query(..., description="SP500, NASDAQ100, or DOW30")) -> dict:
    """Return sorted unique sector list for the given index."""
    from backend.services.index_constituents import get_sectors, INDEX_CONFIG
    index_id_upper = index_id.upper()
    if index_id_upper not in INDEX_CONFIG:
        raise HTTPException(status_code=400, detail=f"Unknown index_id: {index_id!r}. Valid: {list(INDEX_CONFIG)}")
    try:
        sectors = get_sectors(index_id_upper)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to fetch sectors: {exc}") from exc
    return {"sectors": sectors}


@app.post("/screening/debt-ratios", response_model=DebtScreeningResponse)
async def screen_debt_ratios(payload: DebtScreeningRequest) -> DebtScreeningResponse:
    """Screen index constituents by interest-bearing debt / total assets ratio."""
    from backend.services.index_constituents import fetch_constituents, INDEX_CONFIG
    from backend.services.debt_screening import screen_companies

    index_id = payload.index_id.upper()
    if index_id not in INDEX_CONFIG:
        raise HTTPException(status_code=400, detail=f"Unknown index_id: {payload.index_id!r}. Valid: {list(INDEX_CONFIG)}")

    as_of = payload.as_of_date if payload.as_of_date else date.today()

    try:
        constituents = fetch_constituents(index_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to fetch constituents: {exc}") from exc

    # Optional sector filter
    if payload.sector and payload.sector.lower() not in ("all", "all sectors", ""):
        constituents = [c for c in constituents if c.get("sector") == payload.sector]

    semaphore = asyncio.Semaphore(8)
    try:
        raw_results = await screen_companies(constituents, as_of, semaphore)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Screening failed: {exc}") from exc

    results = [CompanyDebtResult(**r) for r in raw_results]
    index_name = INDEX_CONFIG[index_id]["name"]

    return DebtScreeningResponse(
        index_id=index_id,
        index_name=index_name,
        as_of_date=as_of,
        total_screened=len(results),
        results=results,
    )


# ---------------------------------------------------------------------------
# Single company debt ratio lookup
# ---------------------------------------------------------------------------

@app.get("/screening/debt-ratio/{ticker}", response_model=CompanyDebtResult)
async def get_single_debt_ratio(
    ticker: str,
    as_of_date: date | None = Query(default=None),
) -> CompanyDebtResult:
    """Return interest-bearing debt / total assets ratio for a single ticker."""
    from backend.services.debt_screening import _screen_one_sync
    from backend.services.edgar_client import get_edgar_client

    as_of = as_of_date if as_of_date else date.today()
    ticker_upper = ticker.upper().strip()

    # Best-effort company name lookup from SEC submissions
    name = ticker_upper
    try:
        edgar = get_edgar_client()
        cik = edgar.get_cik(ticker_upper)
        if cik:
            submissions = edgar.get_company_submissions(cik) or {}
            name = submissions.get("name", ticker_upper) or ticker_upper
    except Exception:  # noqa: BLE001
        pass

    try:
        result = await asyncio.to_thread(_screen_one_sync, ticker_upper, name, "Unknown", as_of)
        return CompanyDebtResult(**result)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Debt ratio lookup failed: {exc}") from exc


import uvicorn

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port)