# FastAPI entrypoint with Agents SDK setup
import asyncio
import contextlib
import os
import aiohttp
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from backend.schemas import ValuationRequest, ValuationResponse
from backend.services import analyze_portfolio, clear_service_caches

load_dotenv()

app = FastAPI(title="Agentic Financial Tracker",
              docs_url="/docs")


KEEPALIVE_URL = os.getenv("KEEPALIVE_URL")
KEEPALIVE_INTERVAL = 300  # 5 minutes

async def keepalive_task():
    if not KEEPALIVE_URL:
        print("⚠️ KEEPALIVE_URL not set — skipping keepalive.")
        return
    timeout = aiohttp.ClientTimeout(total=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        while True:
            try:
                async with session.get(KEEPALIVE_URL) as resp:
                    print(f"Keepalive → {resp.status} at {KEEPALIVE_URL}")
            except Exception as e:
                print(f"Keepalive failed: {e}")
            await asyncio.sleep(KEEPALIVE_INTERVAL)

@app.on_event("startup")
async def start_keepalive():
    asyncio.create_task(keepalive_task())
    print(f"✅ Keepalive background task started for {KEEPALIVE_URL}")

# ✅ Allow your frontend’s origin
origins = [
    "https://agentic-financial-tracker-for-zakat.vercel.app",
    "http://localhost:3000",  # for local testing
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok", "message": "Backend alive"}

# Allow frontend to talk to backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://agentic-financial-tracker-for-zakat.vercel.app",  # your Vercel production domain

    "http://localhost:3000","healthcheck.railway.app"],  # for local dev],  # Change to ["http://localhost:3000"] if needed
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
        return await analyze_portfolio(payload, cancel_event=cancel_event)
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
def clear_caches() -> dict[str, str]:
    try:
        clear_service_caches()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Cache clearing failed: {exc}") from exc
    return {"status": "ok", "detail": "Service caches cleared."}

@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "Backend is reachable from Vercel"}

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    from fastapi.responses import Response
    return Response(status_code=204)
