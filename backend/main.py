# FastAPI entrypoint with Agents SDK setup
from fastapi import FastAPI, HTTPException
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
    allow_origins=["https://agentic-financial-tracker-for-zakat.vercel.app",  # your Vercel production domain
    "https://agentic-financial-tracker-for-zakat-1n39jz8mx.vercel.app",  # current preview deployment
    "http://localhost:3000"],  # for local dev],  # Change to ["http://localhost:3000"] if needed
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Backend is running!"}

@app.post("/valuation", response_model=ValuationResponse)
async def calculate_valuation(payload: ValuationRequest) -> ValuationResponse:
    try:
        return await analyze_portfolio(payload)
    except Exception as exc:  # noqa: BLE001
        # Surface unexpected errors with generic message while logging stacktrace.
        raise HTTPException(status_code=500, detail=f"Valuation failed: {exc}") from exc


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