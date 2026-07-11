# FastAPI entrypoint with Agents SDK setup
import asyncio
import contextlib
import os

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from backend.schemas import ValuationRequest, ValuationResponse
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

import uvicorn

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port)