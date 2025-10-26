from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class CompanyInput(BaseModel):
    ticker: str = Field(..., min_length=1, description="Ticker symbol of the company")
    shares: Optional[float] = Field(
        default=None, gt=0, description="Optional number of shares held"
    )
    amount: Optional[float] = Field(
        default=None, gt=0, description="Optional notional amount held"
    )


class FundInput(BaseModel):
    ticker: str = Field(..., min_length=1, description="Ticker symbol of the fund or ETF")
    amount: Optional[float] = Field(
        default=None, gt=0, description="Optional notional amount held in the fund or ETF"
    )


class ValuationRequest(BaseModel):
    as_of_date: date = Field(..., description="Date used for valuation and price lookup")
    portfolio: List[CompanyInput] = Field(
        default_factory=list, description="Direct company holdings"
    )
    funds: List[FundInput] = Field(
        default_factory=list, description="Fund or ETF holdings to unpack"
    )


class CompanyValuation(BaseModel):
    ticker: str
    company_name: Optional[str] = None
    currency: Optional[str] = None
    data_date: Optional[date] = None
    price_date: Optional[date] = None
    cash_and_equivalents: Optional[float] = None
    receivables: Optional[float] = None
    inventories: Optional[float] = None
    market_price: Optional[float] = None
    shares_outstanding: Optional[float] = None
    cri_per_share: Optional[float] = None
    cri_to_market_price_ratio: Optional[float] = None
    shares: Optional[float] = None
    warnings: List[str] = Field(default_factory=list)


class FundHoldingValuation(BaseModel):
    ticker: Optional[str] = None
    name: Optional[str] = None
    isin: Optional[str] = None
    cusip: Optional[str] = None
    weight: Optional[float] = None
    company: Optional[CompanyValuation] = None
    warnings: List[str] = Field(default_factory=list)


class FundValuation(BaseModel):
    ticker: str
    fund_name: Optional[str] = None
    currency: Optional[str] = None
    market_price: Optional[float] = None
    price_date: Optional[date] = None
    aggregate_cri_per_share: Optional[float] = None
    aggregate_cri_to_market_price_ratio: Optional[float] = None
    total_weight_covered: Optional[float] = None
    holdings: List[FundHoldingValuation] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ValuationResponse(BaseModel):
    generated_at: datetime
    as_of_date: date
    portfolio: List[CompanyValuation]
    funds: List[FundValuation]
