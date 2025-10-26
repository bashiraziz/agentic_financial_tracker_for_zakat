/* eslint-disable react/no-array-index-key */
"use client";

import { FormEvent, useMemo, useState } from "react";

type CompanyValuation = {
  ticker: string;
  company_name?: string | null;
  currency?: string | null;
  data_date?: string | null;
  price_date?: string | null;
  cash_and_equivalents?: number | null;
  receivables?: number | null;
  inventories?: number | null;
  market_price?: number | null;
  shares_outstanding?: number | null;
  cri_per_share?: number | null;
  cri_to_market_price_ratio?: number | null;
  shares?: number | null;
  warnings: string[];
};

type FundHoldingValuation = {
  ticker: string;
  weight?: number | null;
  company?: CompanyValuation | null;
  warnings: string[];
};

type FundValuation = {
  ticker: string;
  fund_name?: string | null;
  currency?: string | null;
  market_price?: number | null;
  price_date?: string | null;
  aggregate_cri_per_share?: number | null;
  aggregate_cri_to_market_price_ratio?: number | null;
  total_weight_covered?: number | null;
  holdings: FundHoldingValuation[];
  warnings: string[];
};

type ValuationResponse = {
  generated_at: string;
  as_of_date: string;
  portfolio: CompanyValuation[];
  funds: FundValuation[];
};

type PortfolioInputRow = { ticker: string; shares: string };
type FundInputRow = { ticker: string };

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const formatNumber = (
  value?: number | null,
  options?: Intl.NumberFormatOptions,
) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    ...options,
  }).format(value);
};

const formatRatio = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(2)}%`;
};

const formatDate = (value?: string | null) => {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
};

export default function Home() {
  const [asOfDate, setAsOfDate] = useState("");
  const [portfolioRows, setPortfolioRows] = useState<PortfolioInputRow[]>([
    { ticker: "", shares: "" },
  ]);
  const [fundRows, setFundRows] = useState<FundInputRow[]>([{ ticker: "" }]);

  const [portfolioResult, setPortfolioResult] = useState<CompanyValuation[]>([]);
  const [fundResult, setFundResult] = useState<FundValuation[]>([]);
  const [portfolioGeneratedAt, setPortfolioGeneratedAt] = useState<string | null>(null);
  const [fundGeneratedAt, setFundGeneratedAt] = useState<string | null>(null);

  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [fundLoading, setFundLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasResults = useMemo(
    () => portfolioResult.length > 0 || fundResult.length > 0,
    [portfolioResult.length, fundResult.length],
  );

  const handlePortfolioChange = (
    index: number,
    key: keyof PortfolioInputRow,
    value: string,
  ) => {
    setPortfolioRows((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [key]: value.toUpperCase() };
      return copy;
    });
  };

  const handleFundChange = (index: number, value: string) => {
    setFundRows((prev) => {
      const copy = [...prev];
      copy[index] = { ticker: value.toUpperCase() };
      return copy;
    });
  };

  const addPortfolioRow = () =>
    setPortfolioRows((prev) => [...prev, { ticker: "", shares: "" }]);
  const removePortfolioRow = (index: number) =>
    setPortfolioRows((prev) => prev.filter((_, idx) => idx !== index));

  const addFundRow = () => setFundRows((prev) => [...prev, { ticker: "" }]);
  const removeFundRow = (index: number) =>
    setFundRows((prev) => prev.filter((_, idx) => idx !== index));

  const handlePortfolioSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!asOfDate) {
      setError("Select an as-of date before requesting valuations.");
      return;
    }

    const portfolioPayload = portfolioRows
      .filter((row) => row.ticker.trim())
      .map((row) => ({
        ticker: row.ticker.trim(),
        shares: row.shares ? Number(row.shares) : undefined,
      }));

    if (portfolioPayload.length === 0) {
      setError("Add at least one company ticker.");
      return;
    }

    setError(null);
    setPortfolioLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/valuation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          as_of_date: asOfDate,
          portfolio: portfolioPayload,
          funds: [],
        }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Unable to fetch valuations.");
      }

      const payload = (await response.json()) as ValuationResponse;
      setPortfolioResult(payload.portfolio);
      setPortfolioGeneratedAt(payload.generated_at);
    } catch (fetchError) {
      const message =
        fetchError instanceof Error
          ? fetchError.message
          : "Unexpected error requesting valuations.";
      setError(message);
    } finally {
      setPortfolioLoading(false);
    }
  };

  const handleFundFetch = async () => {
    if (!asOfDate) {
      setError("Select an as-of date before requesting fund holdings.");
      return;
    }

    const fundPayload = fundRows
      .filter((row) => row.ticker.trim())
      .map((row) => ({ ticker: row.ticker.trim() }));

    if (fundPayload.length === 0) {
      setError("Add at least one fund or ETF ticker.");
      return;
    }

    setError(null);
    setFundLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/valuation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          as_of_date: asOfDate,
          portfolio: [],
          funds: fundPayload,
        }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Unable to fetch fund holdings.");
      }

      const payload = (await response.json()) as ValuationResponse;
      setFundResult(payload.funds);
      setFundGeneratedAt(payload.generated_at);
    } catch (fetchError) {
      const message =
        fetchError instanceof Error
          ? fetchError.message
          : "Unexpected error requesting fund holdings.";
      setError(message);
    } finally {
      setFundLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-6 pb-24 pt-10">
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">
            Zakat-Ready Valuation Dashboard
          </h1>
          <p className="max-w-3xl text-sm text-slate-300 lg:text-base">
            Assess direct holdings and look-through exposures. Provide an as-of
            date to align cash, receivables, inventory, and market pricing with
            your reporting snapshot.
          </p>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/40">
          <form className="flex flex-col gap-8" onSubmit={handlePortfolioSubmit}>
            <div className="grid gap-4 md:grid-cols-[240px_1fr] md:items-end">
              <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                As-of date
                <input
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                  type="date"
                  value={asOfDate}
                  onChange={(event) => setAsOfDate(event.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </label>
              <p className="text-sm text-slate-400">
                We pull the latest filings and closing prices on or before this
                date.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-100">
                    Portfolio Companies
                  </h2>
                  <button
                    type="button"
                    onClick={addPortfolioRow}
                    className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-sky-400"
                  >
                    + Add company
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  Add tickers you hold directly. Shares are optional but help
                  contextualize position sizing.
                </p>
                <div className="flex flex-col gap-3">
                  {portfolioRows.map((row, index) => (
                    <div
                      key={`portfolio-${index}`}
                      className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 sm:grid-cols-[1fr_160px_auto]"
                    >
                      <input
                        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                        placeholder="Ticker (e.g., AAPL)"
                        value={row.ticker}
                        onChange={(event) =>
                          handlePortfolioChange(
                            index,
                            "ticker",
                            event.target.value,
                          )
                        }
                      />
                      <input
                        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40"
                        placeholder="Shares (optional)"
                        value={row.shares}
                        onChange={(event) =>
                          handlePortfolioChange(
                            index,
                            "shares",
                            event.target.value,
                          )
                        }
                        type="number"
                        min="0"
                        step="any"
                      />
                      <button
                        type="button"
                        className="rounded-md border border-red-500/70 px-3 py-2 text-xs font-semibold text-red-400 transition hover:border-red-400 hover:text-red-300 disabled:opacity-40"
                        onClick={() => removePortfolioRow(index)}
                        disabled={portfolioRows.length === 1}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={portfolioLoading}
                >
                  {portfolioLoading ? "Calculating…" : "Calculate Portfolio CRI"}
                </button>
              </div>

              <div className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-100">
                    Fund & ETF Holdings
                  </h2>
                  <button
                    type="button"
                    onClick={addFundRow}
                    className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
                  >
                    + Add fund
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  Explore look-through holdings. We fetch the latest weights via
                  Polygon and compute CRI metrics for each constituent.
                </p>
                <div className="flex flex-col gap-3">
                  {fundRows.map((row, index) => (
                    <div
                      key={`fund-${index}`}
                      className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3"
                    >
                      <input
                        className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                        placeholder="Fund ticker (e.g., VOO)"
                        value={row.ticker}
                        onChange={(event) =>
                          handleFundChange(index, event.target.value)
                        }
                      />
                      <button
                        type="button"
                        className="rounded-md border border-red-500/70 px-3 py-2 text-xs font-semibold text-red-400 transition hover:border-red-400 hover:text-red-300 disabled:opacity-40"
                        onClick={() => removeFundRow(index)}
                        disabled={fundRows.length === 1}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleFundFetch}
                  className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={fundLoading}
                >
                  {fundLoading ? "Fetching holdings…" : "Fetch Fund Holdings"}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}
          </form>
        </section>

        {hasResults && (
          <section className="flex flex-col gap-8">
            {portfolioResult.length > 0 && (
              <article className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-6">
                <div className="flex flex-col gap-1">
                  <h3 className="text-xl font-semibold text-slate-100">
                    Portfolio Companies
                  </h3>
                  {portfolioGeneratedAt && (
                    <p className="text-xs text-slate-400">
                      Generated at {new Date(portfolioGeneratedAt).toLocaleString()}.
                    </p>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-slate-200">
                    <thead className="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Ticker</th>
                        <th className="px-4 py-3">Company</th>
                        <th className="px-4 py-3">Currency</th>
                        <th className="px-4 py-3">Cash</th>
                        <th className="px-4 py-3">Receivables</th>
                        <th className="px-4 py-3">Inventories</th>
                        <th className="px-4 py-3">Market Price</th>
                        <th className="px-4 py-3">CRI per Share</th>
                        <th className="px-4 py-3">CRI / Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolioResult.map((company) => (
                        <tr
                          key={company.ticker}
                          className="border-b border-slate-800/70 bg-slate-900/50"
                        >
                          <td className="px-4 py-3 font-semibold text-slate-100">
                            {company.ticker}
                          </td>
                          <td className="px-4 py-3">
                            {company.company_name ?? "—"}
                          </td>
                          <td className="px-4 py-3">
                            {company.currency ?? "—"}
                          </td>
                          <td className="px-4 py-3">
                            {formatNumber(company.cash_and_equivalents)}
                          </td>
                          <td className="px-4 py-3">
                            {formatNumber(company.receivables)}
                          </td>
                          <td className="px-4 py-3">
                            {formatNumber(company.inventories)}
                          </td>
                          <td className="px-4 py-3">
                            {formatNumber(company.market_price, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 4,
                            })}
                          </td>
                          <td className="px-4 py-3">
                            {formatNumber(company.cri_per_share, {
                              minimumFractionDigits: 4,
                              maximumFractionDigits: 6,
                            })}
                          </td>
                          <td className="px-4 py-3">
                            {formatRatio(company.cri_to_market_price_ratio)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                        </table>
                  </table>
                </div>
                <div className="flex flex-col gap-3 text-xs text-slate-400">
                  {portfolioResult.map((company) =>
                    company.warnings.length > 0 ? (
                      <div key={`${company.ticker}-warnings`}>
                        <span className="font-semibold text-amber-400">
                          {company.ticker}:
                        </span>{" "}
                        {company.warnings.join(" ")}
                      </div>
                    ) : null,
                  )}
                </div>
              </article>
            )}

            {fundResult.length > 0 && (
              <article className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-6">
                <div className="flex flex-col gap-1">
                  <h3 className="text-xl font-semibold text-slate-100">
                    Fund & ETF Holdings
                  </h3>
                  {fundGeneratedAt && (
                    <p className="text-xs text-slate-400">
                      Generated at {new Date(fundGeneratedAt).toLocaleString()}.
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-6">
                  {fundResult.map((fund) => (
                    <div
                      key={fund.ticker}
                      className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-baseline gap-3">
                          <span className="text-lg font-semibold text-slate-100">
                            {fund.ticker}
                          </span>
                          <span className="text-sm text-slate-400">
                            {fund.fund_name ?? "Name unavailable"}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                          <span>Currency: {fund.currency ?? "—"}</span>
                          <span>
                            Market price:{" "}
                            {formatNumber(fund.market_price, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 4,
                            })}
                            {fund.price_date
                              ? ` (as of ${formatDate(fund.price_date)})`
                              : ""}
                          </span>
                          <span>
                            Aggregate CRI / Price:{" "}
                            {formatRatio(fund.aggregate_cri_to_market_price_ratio)}
                          </span>
                          <span>
                            Aggregate CRI per share:{" "}
                            {formatNumber(fund.aggregate_cri_per_share, {
                              minimumFractionDigits: 4,
                              maximumFractionDigits: 6,
                            })}
                          </span>
                          <span>
                            Weight coverage:{" "}
                            {fund.total_weight_covered !== null &&
                            fund.total_weight_covered !== undefined
                              ? formatRatio(fund.total_weight_covered)
                              : "—"}
                          </span>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-xs text-slate-200">
                          <thead className="bg-slate-900/80 uppercase tracking-wide text-slate-400">
                            <tr>
                              <th className="px-3 py-2">Holding</th>
                              <th className="px-3 py-2">Weight</th>
                              <th className="px-3 py-2">Cash</th>
                              <th className="px-3 py-2">Receivables</th>
                              <th className="px-3 py-2">Inventories</th>
                              <th className="px-3 py-2">Market Price</th>
                              <th className="px-3 py-2">CRI per Share</th>
                              <th className="px-3 py-2">CRI / Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fund.holdings.map((holding, idx) => {
                              const company = holding.company;
                              const ticker = holding.ticker ?? undefined;
                              const name = holding.name ?? undefined;
                              const label =
                                ticker && name && name.toLowerCase() !== ticker.toLowerCase()
                                  ? `${ticker} (${name})`
                                  : ticker ?? name ?? "N/A";

                              const criRatio = company?.cri_to_market_price_ratio ?? null;

                              return (
                                <tr
                                  key={`${fund.ticker}-${ticker ?? name ?? "unknown"}-${idx}`}
                                  className="border-b border-slate-800/70 bg-slate-900/40"
                                >
                                  <td className="px-3 py-2 font-semibold text-slate-100">{label}</td>
                                  <td className="px-3 py-2">
                                    {holding.weight !== null && holding.weight !== undefined
                                      ? formatRatio(holding.weight)
                                      : "N/A"}
                                  </td>
                                  <td className="px-3 py-2">
                                    {formatNumber(company?.cash_and_equivalents ?? null)}
                                  </td>
                                  <td className="px-3 py-2">
                                    {formatNumber(company?.receivables ?? null)}
                                  </td>
                                  <td className="px-3 py-2">
                                    {formatNumber(company?.inventories ?? null)}
                                  </td>
                                  <td className="px-3 py-2">
                                    {formatNumber(company?.market_price ?? null)}
                                  </td>
                                  <td className="px-3 py-2">
                                    {formatNumber(company?.cri_per_share ?? null, {
                                      minimumFractionDigits: 4,
                                      maximumFractionDigits: 6,
                                    })}
                                  </td>
                                  <td className="px-3 py-2">
                                    {criRatio !== null ? formatRatio(criRatio) : "N/A"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      <div className="flex flex-col gap-2 text-xs text-slate-400">
                        {fund.warnings.length > 0 && (
                          <div>
                            <span className="font-semibold text-amber-400">
                              Notes:
                            </span>{" "}
                            {fund.warnings.join(" ")}
                          </div>
                        )}
                        {fund.holdings.map((holding, holdingIdx) =>
                          holding.warnings.length > 0 ? (
                            <div
                              key={`${fund.ticker}-${holdingIdx}-notice`}
                            >
                              <span className="font-semibold text-amber-400">
                                {holding.ticker ?? holding.name ?? "N/A"}:
                              </span>{" "}
                              {holding.warnings.join(" ")}
                            </div>
                          ) : null,
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            )}

            {!hasResults && (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-6 text-sm text-slate-400">
                Add company or fund tickers to see valuation outputs.
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
