
# nport_parser.py - simplified fallback parser from SEC

import requests
from typing import List, Dict

def get_nport_holdings(ticker: str) -> List[Dict[str, object]]:
    # Fallback ETF holdings via SEC NPORT
    # (this is mocked; real implementation would parse XML from SEC)
    url = f"https://data.sec.gov/api/xbrl/company_concepts/CIK{ticker}/us-gaap/Assets.json"
    print(f"Fetching NPORT fallback data from SEC for {ticker} (mocked)")
    # fallback example
    return [
        {"ticker": "AAPL", "weight": 0.3},
        {"ticker": "MSFT", "weight": 0.25},
        {"ticker": "GOOGL", "weight": 0.2},
    ]
