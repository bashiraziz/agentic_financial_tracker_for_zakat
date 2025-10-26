# Agentic Financial Tracker – Usage Guide

Welcome! This guide explains how to use the CRI (Cash + Receivables + Inventories) tracker, what each screen does, and how portfolio data is gathered and computed.

---

## 1. Quick Start

1. **Pick an As-of Date**  
   Use the date picker in the top-left corner. All valuations will align to this reporting date.

2. **Choose a Mode**  
   - *Portfolio* covers direct company holdings.  
   - *Funds & ETFs* lets you analyse look-through holdings from SEC N-PORT filings.

3. **Enter Holdings**  
   - For companies, add tickers (uppercase). Shares and invested amount are optional, but amounts power zakat estimates.  
   - For funds, add ticker symbols and optional invested amounts for zakat estimates.

4. **Run a Valuation**  
   - Click **“Calculate Portfolio CRI”** for companies.  
   - Click **“Fetch Fund Holdings”** for funds.

5. **Review & Export**  
   Results include CRI per share, CRI/Price ratio, zakatable amounts, and warnings. Use **Download CSV** to save the currently visible columns.

---

## 2. Working With Results

### Column Controls
- Use **Customize Columns** to toggle visibility and adjust widths.
- Column headers with an **ⓘ** badge expose tool tips describing the calculation.
- Table headers stay pinned while scrolling for long result sets.

### Zakat Estimates
- **Zakatable Amount** = Invested amount × CRI/Price ratio.  
- **Zakat Due** = Zakatable amount × 2.5%.  
- Results display “–” if an invested amount or ratio is unavailable.

### Fund-Level Metrics
- **Aggregate CRI/Price** is the weighted average (reported SEC weights).
- **Weight Coverage** shows the sum of weights included in the aggregate calculation.
- **Extrapolated CRI/Price** scales the aggregate ratio by coverage (aggregate ÷ coverage) to estimate the full-portfolio ratio when weights do not sum to 100%.

---

## 3. Data Sources & Computation Pipeline

### Financial Statements
- The backend requests quarterly data from the SEC EDGAR API (Concepts: CashAndCashEquivalents, Receivables, Inventories).  
- If a concept is missing for the latest quarter, the service falls back to earlier filings.  
- Shares outstanding come from SEC submissions when available; otherwise Polygon reference data is used.

### Market Prices
- Primary source: **Alpha Vantage** daily close API.  
- Fallback: **Polygon.io** aggregates when Alpha Vantage data is missing or delayed.  
- The latest close on or before the as-of date is selected (Alpha Vantage lookback 120 days, Polygon 60 days).

### CRI Metrics
- **CRI per share** = (Cash + Receivables + Inventories) ÷ Shares outstanding.  
- **CRI / Price ratio** = CRI per share ÷ Market price.

### Fund Holdings
- Holdings are sourced from SEC **Form N-PORT** filings via the `sec_holdings` service.  
- For each holding with a reported weight:  
  - The service reuses the company pipeline above to compute CRI ratios.  
  - A weighted average of ratios builds the aggregate fund ratio.  
- Holdings lacking tickers or weights are excluded and noted in warnings.

### Zakat Calculations
- Entered invested amounts determine zakatable amounts using computed CRI ratios.  
- Zakat due applies a fixed 2.5% rate.  
- These figures help estimate zakat obligations but do not constitute financial advice.

---

## 4. Tips & Troubleshooting

- **Rate Limits**: Alpha Vantage enforces tight rate limits. If you trigger one, the backend retries and reports a warning.  
- **Missing Data**: Expect warnings when filings omit fields, shares are stale, or tickers cannot be matched.  
- **Refreshing Data**: Change the as-of date or re-submit to fetch updated values.  
- **CSV Export**: Exports respect visible columns—hide what you don’t need before downloading.

---

## 5. Need Help?

If data looks off:
- Verify the ticker symbol and as-of date.
- Check warnings at the bottom of each result card.
- Confirm invested amounts if zakat numbers seem low or blank.

For deeper debugging, review the SEC filings referenced in warnings.

Happy analysing!  
