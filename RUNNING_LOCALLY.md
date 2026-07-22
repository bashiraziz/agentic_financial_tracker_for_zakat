# Running Locally

This app has two services that both need to be running:

| Service  | Tech       | Port |
|----------|------------|------|
| Backend  | FastAPI    | 8000 |
| Frontend | Next.js    | 3000 |

---

## 1. Environment Variables

Create a `.env` file in the project root (next to `requirements.txt`):

```env
# AI provider
GEMINI_API_KEY=your-gemini-api-key
LLM_PROVIDER=gemini

# Market data APIs
SEC_USER_AGENT=AgenticFinancialTracker/0.1 (your-email@example.com)
POLYGON_API_KEY=your-polygon-api-key
POLYGON_BASE_URL=https://api.polygon.io
ALPHA_VANTAGE_API_KEY=your-alpha-vantage-key

# Frontend → Backend URL
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## 2. Backend (FastAPI)

From the project root:

```bash
# First time only: create and activate a virtual environment
python -m venv backend/venv

# Activate (Windows PowerShell)
backend\venv\Scripts\activate
# Activate (macOS/Linux)
source backend/venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the server (must be run from project root)
uvicorn backend.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.  
Interactive docs: `http://localhost:8000/docs`

---

## 3. Frontend (Next.js)

In a second terminal, from the project root:

```bash
cd frontend

# First time only
npm install

# Start the dev server
npm run dev
```

Open `http://localhost:3000` in your browser.

---

## Verify It's Working

1. Visit `http://localhost:8000/health` — should return `{"status": "ok"}`
2. Visit `http://localhost:3000` — the frontend should show the backend as connected
3. Enter a fund ticker and run a valuation

---

## API Keys

| Key | Where to get it |
|-----|----------------|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `POLYGON_API_KEY` | [polygon.io](https://polygon.io) |
| `ALPHA_VANTAGE_API_KEY` | [alphavantage.co](https://www.alphavantage.co/support/#api-key) |
