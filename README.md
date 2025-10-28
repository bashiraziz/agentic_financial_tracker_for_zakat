Force deployment
# Agentic Financial Tracker

Multi-agent AI app using Codex, OpenAI Agents SDK, and Gemini.

## SEC EDGAR Access

Financial statement data is pulled from the SEC EDGAR API.  
Before starting the backend, set a compliant user agent so requests are accepted:

```bash
set SEC_USER_AGENT="AgenticFinancialTracker/0.1 (your-email@example.com)"   # PowerShell
export SEC_USER_AGENT="AgenticFinancialTracker/0.1 (your-email@example.com)" # macOS/Linux
```

## Alpha Vantage Market Data

Daily closing prices are retrieved from Alpha Vantage.  
Set your API key before launching the backend:

```bash
set ALPHA_VANTAGE_API_KEY=your-alpha-vantage-key     # PowerShell
export ALPHA_VANTAGE_API_KEY=your-alpha-vantage-key  # macOS/Linux
```

## Polygon Reference Data

Polygon.io remains the source for ETF holdings and ticker reference lookups.  
Be sure to supply a valid API key:

```bash
set POLYGON_API_KEY=your-polygon-key          # PowerShell
export POLYGON_API_KEY=your-polygon-key       # macOS/Linux
```
