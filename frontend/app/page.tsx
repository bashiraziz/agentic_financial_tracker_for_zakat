/* eslint-disable react/no-array-index-key */
"use client";

import type { ReactNode } from "react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components as MarkdownComponents } from "react-markdown";
import { useTheme, type ThemeMode } from "@/components/theme-provider";

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
  ticker?: string | null;
  name?: string | null;
  isin?: string | null;
  cusip?: string | null;
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

type PortfolioInputRow = { ticker: string; shares: string; amount: string };
type FundInputRow = { ticker: string; amount: string };

type ColumnConfig = {
  visible: boolean;
  width: number;
};

type PortfolioColumn = {
  id: string;
  label: string;
  tooltip?: string;
  defaultWidth: number;
  headerClassName?: string;
  cellClassName?: string;
  renderCell: (company: CompanyValuation) => ReactNode;
  getExportValue: (company: CompanyValuation) => string;
  cellTooltip?: (company: CompanyValuation) => string | undefined;
};

type FundHoldingColumn = {
  id: string;
  label: string;
  tooltip?: string;
  defaultWidth: number;
  headerClassName?: string;
  cellClassName?: string;
  renderCell: (holding: FundHoldingValuation) => ReactNode;
  getExportValue: (holding: FundHoldingValuation) => string;
  cellTooltip?: (holding: FundHoldingValuation) => string | undefined;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

const sanitizeCsvValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "";
  }
  const stringValue = String(value);
  const escaped = stringValue.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
};

const createCsvContent = (headers: string[], rows: string[][]) => {
  const csvRows = [headers, ...rows];
  return csvRows.map((row) => row.map(sanitizeCsvValue).join(",")).join("\n");
};

const triggerCsvDownload = (filename: string, csvContent: string) => {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

const buildFilenameTimestamp = (value?: string | null) => {
  const base = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(base.getTime()) ? new Date() : base;
  return safeDate.toISOString().replace(/:/g, "-");
};

const ZAKAT_RATE = 0.025;

const TooltipIcon = ({ text }: { text: string }) => (
  <span
    className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-500/60 text-[0.6rem] font-semibold text-slate-300 transition hover:border-slate-300/80 hover:text-slate-100"
    title={text}
    aria-label={text}
    role="img"
  >
    i
  </span>
);

const INSTRUCTIONS_FALLBACK_MESSAGE =
  "Instructions could not be loaded automatically.\n\nYou can open the markdown guide in a new tab via the button above or review the project README.";

const codeRenderer: NonNullable<MarkdownComponents["code"]> = ({ node, ...props }) => {
  const inline = (props as { inline?: boolean }).inline;
  return inline ? (
    <code className="rounded bg-slate-800/70 px-1 py-0.5 text-xs text-emerald-300" {...props} />
  ) : (
    <code {...props} />
  );
};

const markdownComponents: MarkdownComponents = {
  h1: ({ node, ...props }) => (
    <h1 className="mt-6 text-2xl font-semibold text-slate-100 first:mt-0" {...props} />
  ),
  h2: ({ node, ...props }) => (
    <h2 className="mt-6 text-xl font-semibold text-slate-100 first:mt-0" {...props} />
  ),
  h3: ({ node, ...props }) => (
    <h3 className="mt-4 text-lg font-semibold text-slate-100 first:mt-0" {...props} />
  ),
  p: ({ node, ...props }) => (
    <p className="mt-3 text-sm leading-relaxed text-slate-200 first:mt-0" {...props} />
  ),
  ul: ({ node, ...props }) => (
    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-200 first:mt-0" {...props} />
  ),
  ol: ({ node, ...props }) => (
    <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-200 first:mt-0" {...props} />
  ),
  li: ({ node, ...props }) => <li className="leading-relaxed text-slate-200" {...props} />,
  code: codeRenderer,
  pre: ({ node, ...props }) => (
    <pre
      className="mt-3 overflow-x-auto rounded-lg border border-slate-800/80 bg-slate-950/80 p-3 text-xs text-slate-200 first:mt-0"
      {...props}
    />
  ),
  hr: ({ node, ...props }) => <hr className="my-6 border-slate-800/60" {...props} />,
  a: ({ node, ...props }) => (
    <a
      className="font-semibold text-sky-300 underline decoration-sky-500/60 underline-offset-2 hover:text-sky-200 hover:decoration-sky-300"
      {...props}
    />
  ),
};

export default function Home() {
  const [asOfDate, setAsOfDate] = useState("");
  const [portfolioRows, setPortfolioRows] = useState<PortfolioInputRow[]>([
    { ticker: "", shares: "", amount: "" },
  ]);
  const [fundRows, setFundRows] = useState<FundInputRow[]>([{ ticker: "", amount: "" }]);

  const [portfolioResult, setPortfolioResult] = useState<CompanyValuation[]>([]);
  const [fundResult, setFundResult] = useState<FundValuation[]>([]);
  const [portfolioGeneratedAt, setPortfolioGeneratedAt] = useState<string | null>(null);
  const [fundGeneratedAt, setFundGeneratedAt] = useState<string | null>(null);

  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [fundLoading, setFundLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"portfolio" | "funds">("portfolio");
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructionsContent, setInstructionsContent] = useState<string | null>(null);
  const [instructionsLoading, setInstructionsLoading] = useState(false);
  const [instructionsError, setInstructionsError] = useState<string | null>(null);
  const [serviceDetailsOpen, setServiceDetailsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (!instructionsOpen || instructionsContent !== null) {
      return;
    }

    const controller = new AbortController();
    let abortedByCleanup = false;
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);

    const loadInstructions = async () => {
      setInstructionsLoading(true);
      setInstructionsError(null);
      try {
        const response = await fetch("/api/usage-guide", {
          signal: controller.signal,
          cache: "no-store",
        });
        window.clearTimeout(timeoutId);
        if (!response.ok) {
          throw new Error(`Unable to load instructions (status ${response.status}).`);
        }
        const text = await response.text();
        if (!controller.signal.aborted) {
          setInstructionsContent(text);
        }
      } catch (fetchError) {
        let message = "Unable to load instructions.";
        if (controller.signal.aborted) {
          if (abortedByCleanup) {
            setInstructionsLoading(false);
            return;
          }
          message = "Timed out while loading instructions. Please try again.";
        } else if (fetchError instanceof Error) {
          message = fetchError.message;
        }
        setInstructionsError(message);
        setInstructionsContent((current) => current ?? INSTRUCTIONS_FALLBACK_MESSAGE);
      } finally {
        setInstructionsLoading(false);
      }
    };

    void loadInstructions();

    return () => {
      abortedByCleanup = true;
      window.clearTimeout(timeoutId);
      controller.abort();
      setInstructionsLoading(false);
    };
  }, [instructionsOpen, instructionsContent]);

  const fundAmountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of fundRows) {
      const ticker = row.ticker.trim().toUpperCase();
      if (!ticker) {
        continue;
      }
      const amountValue = Number(row.amount);
      if (!Number.isFinite(amountValue)) {
        continue;
      }
      map.set(ticker, (map.get(ticker) ?? 0) + amountValue);
    }
    return map;
  }, [fundRows]);

  const portfolioAmountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of portfolioRows) {
      const ticker = row.ticker.trim().toUpperCase();
      if (!ticker) {
        continue;
      }
      const amountValue = Number(row.amount);
      if (!Number.isFinite(amountValue)) {
        continue;
      }
      map.set(ticker, (map.get(ticker) ?? 0) + amountValue);
    }
    return map;
  }, [portfolioRows]);

  const joinClasses = (...classes: (string | undefined)[]) =>
    classes.filter(Boolean).join(" ");

  const LoadingSpinner = ({ className = "h-4 w-4" }: { className?: string }) => (
    <svg
      className={joinClasses("animate-spin text-sky-400", className)}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );

  const LoadingBanner = ({
    message,
    accent,
  }: {
    message: string;
    accent: "sky" | "emerald";
  }) => {
    const accents = {
      sky: {
        border: "border-sky-500/40",
        background: "bg-sky-500/10",
        text: "text-sky-100",
        spinner: "text-sky-200",
      },
      emerald: {
        border: "border-emerald-400/40",
        background: "bg-emerald-400/10",
        text: "text-emerald-100",
        spinner: "text-emerald-200",
      },
    } as const;
    const style = accents[accent];

    return (
      <div
        className={joinClasses(
          "mt-3 flex items-center gap-3 rounded-lg border px-4 py-3 shadow-inner shadow-slate-950/40",
          style.border,
          style.background,
        )}
      >
        <LoadingSpinner className={joinClasses("h-5 w-5", style.spinner)} />
        <p className={joinClasses("text-sm font-medium", style.text)}>{message}</p>
      </div>
    );
  };

  const themeActiveClasses: Record<ThemeMode, string> = {
    light: "bg-sky-500 text-slate-950 shadow-sm shadow-sky-500/40",
    mid: "bg-amber-400 text-slate-950 shadow-sm shadow-amber-500/40",
    dark: "bg-slate-100 text-slate-900 shadow-sm shadow-slate-100/30",
  };

  const themeButtonClasses = (mode: ThemeMode) =>
    joinClasses(
      "flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition",
      theme === mode
        ? themeActiveClasses[mode]
        : "text-slate-300 hover:text-slate-100",
    );

  const computePortfolioZakatableAmount = (company: CompanyValuation) => {
    if (!company.ticker) {
      return null;
    }
    const investedAmount = portfolioAmountMap.get(company.ticker.toUpperCase());
    const ratio =
      typeof company.cri_to_market_price_ratio === "number"
        ? company.cri_to_market_price_ratio
        : null;
    if (investedAmount === undefined || ratio === null) {
      return null;
    }
    return investedAmount * ratio;
  };

  const computePortfolioZakatDue = (company: CompanyValuation) => {
    const zakatableAmount = computePortfolioZakatableAmount(company);
    if (zakatableAmount === null) {
      return null;
    }
    return zakatableAmount * ZAKAT_RATE;
  };

  const portfolioColumns = useMemo<PortfolioColumn[]>(() => {
    return [
      {
        id: "ticker",
        label: "Ticker",
        defaultWidth: 140,
        cellClassName: "font-semibold text-slate-100",
        renderCell: (company) => company.ticker ?? "-",
        getExportValue: (company) => company.ticker ?? "-",
      },
      {
        id: "company",
        label: "Company",
        defaultWidth: 220,
        renderCell: (company) => company.company_name ?? "-",
        getExportValue: (company) => company.company_name ?? "-",
      },
      {
        id: "currency",
        label: "Currency",
        defaultWidth: 120,
        renderCell: (company) => company.currency ?? "-",
        getExportValue: (company) => company.currency ?? "-",
      },
      {
        id: "cash",
        label: "Cash",
        defaultWidth: 140,
        renderCell: (company) => formatNumber(company.cash_and_equivalents),
        getExportValue: (company) => formatNumber(company.cash_and_equivalents),
      },
      {
        id: "receivables",
        label: "Receivables",
        defaultWidth: 140,
        renderCell: (company) => formatNumber(company.receivables),
        getExportValue: (company) => formatNumber(company.receivables),
      },
      {
        id: "inventories",
        label: "Inventories",
        defaultWidth: 140,
        renderCell: (company) => formatNumber(company.inventories),
        getExportValue: (company) => formatNumber(company.inventories),
      },
      {
        id: "market_price",
        label: "Market Price",
        defaultWidth: 160,
        renderCell: (company) =>
          formatNumber(company.market_price, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 4,
          }),
        getExportValue: (company) =>
          formatNumber(company.market_price, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 4,
          }),
      },
      {
        id: "shares",
        label: "Shares Used",
        defaultWidth: 150,
        renderCell: (company) =>
          formatNumber(company.shares_outstanding, {
            maximumFractionDigits: 0,
          }),
        getExportValue: (company) =>
          formatNumber(company.shares_outstanding, {
            maximumFractionDigits: 0,
          }),
      },
      {
        id: "cri_per_share",
        label: "CRI per Share",
        tooltip: "Cash + Receivables + Inventories ÷ Shares outstanding",
        defaultWidth: 160,
        renderCell: (company) =>
          formatNumber(company.cri_per_share, {
            minimumFractionDigits: 4,
            maximumFractionDigits: 6,
          }),
        getExportValue: (company) =>
          formatNumber(company.cri_per_share, {
            minimumFractionDigits: 4,
            maximumFractionDigits: 6,
          }),
        cellTooltip: () => "Cash + Receivables + Inventories ÷ Shares outstanding",
      },
      {
        id: "cri_ratio",
        label: "CRI / Price",
        tooltip: "CRI per share ÷ Market price",
        defaultWidth: 140,
        renderCell: (company) => formatRatio(company.cri_to_market_price_ratio),
        getExportValue: (company) => formatRatio(company.cri_to_market_price_ratio),
        cellTooltip: () => "CRI per share ÷ Market price",
      },
      {
        id: "zakatable_amount",
        label: "Zakatable Amount",
        tooltip: "Invested amount x CRI / Price ratio",
        defaultWidth: 180,
        renderCell: (company) => {
          const zakatableAmount = computePortfolioZakatableAmount(company);
          return formatNumber(zakatableAmount, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
        },
        getExportValue: (company) => {
          const zakatableAmount = computePortfolioZakatableAmount(company);
          return formatNumber(zakatableAmount, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
        },
        cellTooltip: () => "Invested amount x CRI / Price ratio",
      },
      {
        id: "zakat_due",
        label: "Zakat Due",
        tooltip: "Zakatable amount x 2.5%",
        defaultWidth: 160,
        renderCell: (company) => {
          const zakatDue = computePortfolioZakatDue(company);
          return formatNumber(zakatDue, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
        },
        getExportValue: (company) => {
          const zakatDue = computePortfolioZakatDue(company);
          return formatNumber(zakatDue, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
        },
        cellTooltip: () => "Zakatable amount x 2.5%",
      },
    ];
  }, [portfolioAmountMap]);

  const [portfolioColumnConfig, setPortfolioColumnConfig] = useState<
    Record<string, ColumnConfig>
  >(() =>
    Object.fromEntries(
      portfolioColumns.map((column) => [
        column.id,
        { visible: true, width: column.defaultWidth },
      ]),
    ) as Record<string, ColumnConfig>,
  );
  const [showPortfolioColumnSettings, setShowPortfolioColumnSettings] = useState(false);

  useEffect(() => {
    setPortfolioColumnConfig((prev) => {
      let changed = false;
      const next: Record<string, ColumnConfig> = { ...prev };
      for (const column of portfolioColumns) {
        if (!next[column.id]) {
          next[column.id] = { visible: true, width: column.defaultWidth };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [portfolioColumns]);

  const handlePortfolioColumnVisibilityChange = (columnId: string, visible: boolean) => {
    const column = portfolioColumns.find((col) => col.id === columnId);
    const fallbackWidth = column?.defaultWidth ?? 160;
    setPortfolioColumnConfig((prev) => ({
      ...prev,
      [columnId]: {
        visible,
        width: prev[columnId]?.width ?? fallbackWidth,
      },
    }));
  };

  const handlePortfolioColumnWidthChange = (columnId: string, width: number) => {
    setPortfolioColumnConfig((prev) => ({
      ...prev,
      [columnId]: {
        visible: prev[columnId]?.visible ?? true,
        width,
      },
    }));
  };

  const getFundHoldingLabel = (holding: FundHoldingValuation) => {
    const ticker = holding.ticker ?? undefined;
    const name = holding.name ?? undefined;
    if (ticker && name && name.toLowerCase() !== ticker.toLowerCase()) {
      return `${ticker} (${name})`;
    }
    return ticker ?? name ?? "N/A";
  };

  const fundHoldingColumns = useMemo<FundHoldingColumn[]>(() => {
    return [
      {
        id: "holding",
        label: "Holding",
        defaultWidth: 220,
        cellClassName: "font-semibold text-slate-100",
        renderCell: (holding) => getFundHoldingLabel(holding),
        getExportValue: (holding) => getFundHoldingLabel(holding),
      },
      {
        id: "weight",
        label: "Weight",
        tooltip: "Holding weight in the fund as reported in SEC filings",
        defaultWidth: 120,
        renderCell: (holding) =>
          holding.weight !== null && holding.weight !== undefined
            ? formatRatio(holding.weight)
            : "N/A",
        getExportValue: (holding) =>
          holding.weight !== null && holding.weight !== undefined
            ? formatRatio(holding.weight)
            : "N/A",
        cellTooltip: () => "Holding weight in the fund as reported in SEC filings",
      },
      {
        id: "cash",
        label: "Cash",
        defaultWidth: 140,
        renderCell: (holding) =>
          formatNumber(holding.company?.cash_and_equivalents ?? null),
        getExportValue: (holding) =>
          formatNumber(holding.company?.cash_and_equivalents ?? null),
      },
      {
        id: "receivables",
        label: "Receivables",
        defaultWidth: 150,
        renderCell: (holding) =>
          formatNumber(holding.company?.receivables ?? null),
        getExportValue: (holding) =>
          formatNumber(holding.company?.receivables ?? null),
      },
      {
        id: "inventories",
        label: "Inventories",
        defaultWidth: 150,
        renderCell: (holding) =>
          formatNumber(holding.company?.inventories ?? null),
        getExportValue: (holding) =>
          formatNumber(holding.company?.inventories ?? null),
      },
      {
        id: "market_price",
        label: "Market Price",
        defaultWidth: 150,
        renderCell: (holding) =>
          formatNumber(holding.company?.market_price ?? null),
        getExportValue: (holding) =>
          formatNumber(holding.company?.market_price ?? null),
      },
      {
        id: "shares",
        label: "Shares Used",
        defaultWidth: 150,
        renderCell: (holding) =>
          formatNumber(holding.company?.shares_outstanding ?? null, {
            maximumFractionDigits: 0,
          }),
        getExportValue: (holding) =>
          formatNumber(holding.company?.shares_outstanding ?? null, {
            maximumFractionDigits: 0,
          }),
      },
      {
        id: "cri_per_share",
        label: "CRI per Share",
        tooltip: "Cash + Receivables + Inventories ÷ Shares outstanding",
        defaultWidth: 160,
        renderCell: (holding) =>
          formatNumber(holding.company?.cri_per_share ?? null, {
            minimumFractionDigits: 4,
            maximumFractionDigits: 6,
          }),
        getExportValue: (holding) =>
          formatNumber(holding.company?.cri_per_share ?? null, {
            minimumFractionDigits: 4,
            maximumFractionDigits: 6,
          }),
        cellTooltip: () => "Cash + Receivables + Inventories ÷ Shares outstanding",
      },
      {
        id: "cri_ratio",
        label: "CRI / Price",
        tooltip: "CRI per share ÷ Market price",
        defaultWidth: 140,
        renderCell: (holding) => {
          const ratio = holding.company?.cri_to_market_price_ratio ?? null;
          return ratio !== null ? formatRatio(ratio) : "N/A";
        },
        getExportValue: (holding) => {
          const ratio = holding.company?.cri_to_market_price_ratio ?? null;
          return ratio !== null ? formatRatio(ratio) : "N/A";
        },
        cellTooltip: () => "CRI per share ÷ Market price",
      },
    ];
  }, []);

  const [fundHoldingColumnConfig, setFundHoldingColumnConfig] = useState<
    Record<string, ColumnConfig>
  >(() =>
    Object.fromEntries(
      fundHoldingColumns.map((column) => [
        column.id,
        { visible: true, width: column.defaultWidth },
      ]),
    ) as Record<string, ColumnConfig>,
  );
  const [showFundColumnSettings, setShowFundColumnSettings] = useState(false);

  useEffect(() => {
    setFundHoldingColumnConfig((prev) => {
      let changed = false;
      const next: Record<string, ColumnConfig> = { ...prev };
      for (const column of fundHoldingColumns) {
        if (!next[column.id]) {
          next[column.id] = { visible: true, width: column.defaultWidth };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [fundHoldingColumns]);

  const handleFundColumnVisibilityChange = (columnId: string, visible: boolean) => {
    const column = fundHoldingColumns.find((col) => col.id === columnId);
    const fallbackWidth = column?.defaultWidth ?? 160;
    setFundHoldingColumnConfig((prev) => ({
      ...prev,
      [columnId]: {
        visible,
        width: prev[columnId]?.width ?? fallbackWidth,
      },
    }));
  };

  const handleFundColumnWidthChange = (columnId: string, width: number) => {
    setFundHoldingColumnConfig((prev) => ({
      ...prev,
      [columnId]: {
        visible: prev[columnId]?.visible ?? true,
        width,
      },
    }));
  };

  const visiblePortfolioColumns = useMemo(
    () =>
      portfolioColumns.filter(
        (column) => portfolioColumnConfig[column.id]?.visible ?? true,
      ),
    [portfolioColumns, portfolioColumnConfig],
  );

  const visibleFundHoldingColumns = useMemo(
    () =>
      fundHoldingColumns.filter(
        (column) => fundHoldingColumnConfig[column.id]?.visible ?? true,
      ),
    [fundHoldingColumns, fundHoldingColumnConfig],
  );

  const hasPortfolioResults = portfolioResult.length > 0;
  const hasFundResults = fundResult.length > 0;
  const hasActiveResults = useMemo(() => {
    return activeTab === "portfolio" ? hasPortfolioResults : hasFundResults;
  }, [activeTab, hasPortfolioResults, hasFundResults]);

  const downloadButtonClasses =
    "inline-flex items-center justify-center rounded-md border border-sky-500/60 px-3 py-2 text-xs font-semibold text-sky-300 transition hover:border-sky-300 hover:text-sky-200 disabled:cursor-not-allowed disabled:opacity-50";

  const handlePortfolioChange = (
    index: number,
    key: keyof PortfolioInputRow,
    value: string,
  ) => {
    setPortfolioRows((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        [key]: key === "ticker" ? value.toUpperCase() : value,
      };
      return copy;
    });
  };

  const handleFundChange = (
    index: number,
    key: keyof FundInputRow,
    value: string,
  ) => {
    setFundRows((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        [key]: key === "ticker" ? value.toUpperCase() : value,
      };
      return copy;
    });
  };

  const addPortfolioRow = () =>
    setPortfolioRows((prev) => [...prev, { ticker: "", shares: "", amount: "" }]);
  const removePortfolioRow = (index: number) =>
    setPortfolioRows((prev) => prev.filter((_, idx) => idx !== index));

  const addFundRow = () => setFundRows((prev) => [...prev, { ticker: "", amount: "" }]);
  const removeFundRow = (index: number) =>
    setFundRows((prev) => prev.filter((_, idx) => idx !== index));

  const handleDownloadPortfolio = () => {
    if (portfolioResult.length === 0) {
      return;
    }

    const exportColumns = portfolioColumns.filter(
      (column) => portfolioColumnConfig[column.id]?.visible ?? true,
    );
    const headers = [...exportColumns.map((column) => column.label), "Warnings"];

    const rows = portfolioResult.map((company) => [
      ...exportColumns.map((column) => column.getExportValue(company)),
      company.warnings.join(" "),
    ]);

    const timestamp = buildFilenameTimestamp(portfolioGeneratedAt);
    const csvContent = createCsvContent(headers, rows);
    triggerCsvDownload(`portfolio-valuations-${timestamp}.csv`, csvContent);
  };

  const handleDownloadFundHoldings = (fund: FundValuation) => {
    if (fund.holdings.length === 0) {
      return;
    }

    const headers = [
      "Holding",
      "Ticker",
      "Name",
      "ISIN",
      "CUSIP",
      "Weight",
      "Cash",
      "Receivables",
      "Inventories",
      "Market Price",
      "Shares",
      "CRI per Share",
      "CRI / Price",
      "Holding Warnings",
      "Company Warnings",
    ];

    const rows = fund.holdings.map((holding) => {
      const company = holding.company;
      const ticker = holding.ticker ?? undefined;
      const name = holding.name ?? undefined;
      const label =
        ticker && name && name.toLowerCase() !== ticker.toLowerCase()
          ? `${ticker} (${name})`
          : ticker ?? name ?? "N/A";

      const criRatio = company?.cri_to_market_price_ratio ?? null;

      return [
        label,
        holding.ticker ?? "—",
        holding.name ?? "—",
        holding.isin ?? "—",
        holding.cusip ?? "—",
        holding.weight !== null && holding.weight !== undefined
          ? formatRatio(holding.weight)
          : "N/A",
        formatNumber(company?.cash_and_equivalents ?? null),
        formatNumber(company?.receivables ?? null),
        formatNumber(company?.inventories ?? null),
        formatNumber(company?.market_price ?? null),
        formatNumber(company?.shares_outstanding ?? null, {
          maximumFractionDigits: 0,
        }),
        formatNumber(company?.cri_per_share ?? null, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 6,
        }),
        criRatio !== null ? formatRatio(criRatio) : "N/A",
        holding.warnings.join(" "),
        company?.warnings?.join(" ") ?? "",
      ];
    });

    const timestamp = buildFilenameTimestamp(fundGeneratedAt);
    const filename = `${fund.ticker || "fund"}-holdings-${timestamp}.csv`.toLowerCase();
    const csvContent = createCsvContent(headers, rows);
    triggerCsvDownload(filename, csvContent);
  };

  const handlePortfolioSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activeTab !== "portfolio") {
      return;
    }
    if (!asOfDate) {
      setError("Select an as-of date before requesting valuations.");
      return;
    }

    const portfolioPayload = portfolioRows
      .filter((row) => row.ticker.trim())
      .map((row) => ({
        ticker: row.ticker.trim(),
        shares: row.shares ? Number(row.shares) : undefined,
        amount: row.amount ? Number(row.amount) : undefined,
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
      .map((row) => ({
        ticker: row.ticker.trim(),
        amount: row.amount ? Number(row.amount) : undefined,
      }));

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
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 pb-24 pt-10 lg:flex-row lg:gap-12">
        <div className="flex flex-1 flex-col gap-10">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <header className="flex flex-col gap-3">
                <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">
                  Zakatable Assets in Stocks, ETFs, and Funds
                </h1>
                <p className="max-w-3xl text-sm text-slate-300 lg:text-base">
                  Assess direct holdings and look-through exposures. Provide an as-of
                  date to align cash, receivables, inventory, and market pricing with
                  your reporting snapshot.
                </p>
              </header>
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className="text-xs text-slate-300">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Theme
                  </span>
                  <div
                    role="group"
                    aria-label="Color theme"
                    className="mt-2 flex rounded-full border border-slate-700 bg-slate-950/60 p-1"
                  >
                    <button
                      type="button"
                      aria-pressed={theme === "light"}
                      onClick={() => setTheme("light")}
                      className={themeButtonClasses("light")}
                    >
                      Light
                    </button>
                    <button
                      type="button"
                      aria-pressed={theme === "mid"}
                      onClick={() => setTheme("mid")}
                      className={themeButtonClasses("mid")}
                    >
                      Mid
                    </button>
                    <button
                      type="button"
                      aria-pressed={theme === "dark"}
                      onClick={() => setTheme("dark")}
                      className={themeButtonClasses("dark")}
                    >
                      Dark
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSidebarOpen((open) => !open)}
                  className="rounded-md border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-sky-400 hover:text-sky-200"
                  aria-expanded={sidebarOpen}
                >
                  {sidebarOpen ? "Hide info panel" : "Show info panel"}
                </button>
              </div>
            </div>
          </div>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/40">
          <form className="flex flex-col gap-8" onSubmit={handlePortfolioSubmit}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="grid flex-1 gap-4 md:grid-cols-[240px_1fr] md:items-end">
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

              {/* Health check button */}
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE_URL}/health`);
                    const data = await res.json();
                    alert(`? ${data.message || "Backend reachable!"}`);
                  } catch (err) {
                    alert("? Could not reach backend. Check API URL or CORS.");
                    console.error(err);
                  }
                }}
                className="w-full rounded-md border border-sky-500/60 px-3 py-2 text-xs font-semibold text-sky-300 transition hover:border-sky-300 hover:text-sky-200 md:w-auto"
              >
                Check Backend Connection
              </button>
            </div>

            <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-1 text-sm font-semibold text-slate-300">
              <button
                type="button"
                onClick={() => setActiveTab("portfolio")}
                className={`flex-1 rounded-lg px-4 py-2 transition ${
                  activeTab === "portfolio"
                    ? "bg-sky-500 text-slate-950 shadow-sm shadow-sky-500/40"
                    : "text-slate-300 hover:text-slate-100"
                }`}
              >
                Portfolio Companies
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("funds")}
                className={`flex-1 rounded-lg px-4 py-2 transition ${
                  activeTab === "funds"
                    ? "bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/40"
                    : "text-slate-300 hover:text-slate-100"
                }`}
              >
                Funds & ETFs
              </button>
            </div>

            {activeTab === "portfolio" && (
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
                      className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 sm:grid-cols-[1fr_160px_160px_auto]"
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
                      <input
                        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40"
                        placeholder="Amount (optional)"
                        value={row.amount}
                        onChange={(event) =>
                          handlePortfolioChange(
                            index,
                            "amount",
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
                  className="inline-flex w-full items-center justify-center rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={portfolioLoading}
                >
                  {portfolioLoading ? (
                    <span className="flex items-center gap-2">
                      <LoadingSpinner />
                      <span>Calculating...</span>
                    </span>
                  ) : (
                    "Calculate Portfolio CRI"
                  )}
                </button>
                {portfolioLoading && (
                  <LoadingBanner
                    message="Crunching company fundamentals and CRI ratios..."
                    accent="sky"
                  />
                )}
              </div>
            )}

            {activeTab === "funds" && (
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
                  Explore look-through holdings. We pull holdings from SEC
                  N-PORT filings, price them with Alpha Vantage, and fall back to
                  Polygon where needed.
                </p>
                <div className="flex flex-col gap-3">
                  {fundRows.map((row, index) => (
                    <div
                      key={`fund-${index}`}
                      className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 sm:grid-cols-[1fr_160px_auto]"
                    >
                      <input
                        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                        placeholder="Fund ticker (e.g., VOO)"
                        value={row.ticker}
                        onChange={(event) =>
                          handleFundChange(index, "ticker", event.target.value)
                        }
                      />
                      <input
                        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40"
                        placeholder="Amount (optional)"
                        value={row.amount}
                        onChange={(event) =>
                          handleFundChange(index, "amount", event.target.value)
                        }
                        type="number"
                        min="0"
                        step="any"
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
                  className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={fundLoading}
                >
                  {fundLoading ? (
                    <span className="flex items-center gap-2">
                      <LoadingSpinner className="h-4 w-4 text-emerald-100" />
                      <span>Fetching holdings...</span>
                    </span>
                  ) : (
                    "Fetch Fund Holdings"
                  )}
                </button>
                {fundLoading && (
                  <LoadingBanner
                    message="Gathering fund holdings and refreshing prices..."
                    accent="emerald"
                  />
                )}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}
          </form>
        </section>

        {hasActiveResults ? (
          <section className="flex flex-col gap-8">
            {activeTab === "portfolio" && portfolioResult.length > 0 && (
              <article className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
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
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={downloadButtonClasses}
                      onClick={handleDownloadPortfolio}
                      disabled={portfolioResult.length === 0}
                    >
                      Download CSV
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-sky-400 hover:text-sky-200"
                      onClick={() =>
                        setShowPortfolioColumnSettings((previous) => !previous)
                      }
                    >
                      {showPortfolioColumnSettings ? "Close Column Settings" : "Customize Columns"}
                    </button>
                  </div>
                </div>
                {showPortfolioColumnSettings && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-200">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {portfolioColumns.map((column) => {
                        const config = portfolioColumnConfig[column.id];
                        const isVisible = config?.visible ?? true;
                        const width = Math.round(config?.width ?? column.defaultWidth);
                        return (
                          <div
                            key={column.id}
                            className="flex flex-col gap-3 rounded-lg border border-slate-800/60 bg-slate-900/40 p-3"
                          >
                            <label className="flex items-center gap-2 text-slate-100">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-sky-500 focus:ring-sky-500"
                                checked={isVisible}
                                onChange={(event) =>
                                  handlePortfolioColumnVisibilityChange(column.id, event.target.checked)
                                }
                              />
                              <span>{column.label}</span>
                            </label>
                            <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-slate-400">
                              <input
                                type="range"
                                min={96}
                                max={320}
                                step={4}
                                value={width}
                                onChange={(event) =>
                                  handlePortfolioColumnWidthChange(
                                    column.id,
                                    Number(event.target.value),
                                  )
                                }
                                className="h-1 w-full accent-sky-500"
                              />
                              <span className="font-semibold text-slate-300">{width}px</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  {visiblePortfolioColumns.length > 0 ? (
                    <table className="min-w-full text-left text-sm text-slate-200">
                      <thead className="sticky top-0 z-10 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-400 backdrop-blur">
                        <tr>
                          {visiblePortfolioColumns.map((column) => {
                            const width = portfolioColumnConfig[column.id]?.width ?? column.defaultWidth;
                            const headerClasses = joinClasses("px-4 py-3", column.headerClassName);
                            return (
                              <th
                                key={column.id}
                                className={headerClasses}
                                style={{ width, minWidth: width }}
                              >
                                <span className="inline-flex items-center gap-1">
                                  <span>{column.label}</span>
                                  {column.tooltip ? <TooltipIcon text={column.tooltip} /> : null}
                                </span>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {portfolioResult.map((company, companyIdx) => (
                          <tr
                            key={`${company.ticker ?? "company"}-${companyIdx}`}
                            className="border-b border-slate-800/70 bg-slate-900/50"
                          >
                            {visiblePortfolioColumns.map((column) => {
                              const width = portfolioColumnConfig[column.id]?.width ?? column.defaultWidth;
                              const cellClasses = joinClasses("px-4 py-3", column.cellClassName);
                              const cellTitle = column.cellTooltip?.(company);
                              return (
                                <td
                                  key={column.id}
                                  className={cellClasses}
                                  style={{ width, minWidth: width }}
                                  title={cellTitle}
                                >
                                  {column.renderCell(company)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300">
                      Select at least one column to display results.
                    </div>
                  )}
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

            {activeTab === "funds" && fundResult.length > 0 && (
              <article className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
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
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-sky-400 hover:text-sky-200"
                    onClick={() =>
                      setShowFundColumnSettings((previous) => !previous)
                    }
                  >
                    {showFundColumnSettings ? "Close Column Settings" : "Customize Columns"}
                  </button>
                </div>
                {showFundColumnSettings && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-200">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {fundHoldingColumns.map((column) => {
                        const config = fundHoldingColumnConfig[column.id];
                        const isVisible = config?.visible ?? true;
                        const width = Math.round(config?.width ?? column.defaultWidth);
                        return (
                          <div
                            key={column.id}
                            className="flex flex-col gap-3 rounded-lg border border-slate-800/60 bg-slate-900/40 p-3"
                          >
                            <label className="flex items-center gap-2 text-slate-100">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-sky-500 focus:ring-sky-500"
                                checked={isVisible}
                                onChange={(event) =>
                                  handleFundColumnVisibilityChange(column.id, event.target.checked)
                                }
                              />
                              <span>{column.label}</span>
                            </label>
                            <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-slate-400">
                              <input
                                type="range"
                                min={96}
                                max={320}
                                step={4}
                                value={width}
                                onChange={(event) =>
                                  handleFundColumnWidthChange(
                                    column.id,
                                    Number(event.target.value),
                                  )
                                }
                                className="h-1 w-full accent-emerald-500"
                              />
                              <span className="font-semibold text-slate-300">{width}px</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-6">
                  {fundResult.map((fund) => {
                    const aggregateCriRatio =
                      fund.aggregate_cri_to_market_price_ratio ?? null;
                    const totalWeightCovered =
                      fund.total_weight_covered ?? null;
                    const extrapolatedCriRatio =
                      aggregateCriRatio !== null &&
                      totalWeightCovered !== null &&
                      totalWeightCovered > 0
                        ? aggregateCriRatio / totalWeightCovered
                        : null;
                    const investedAmount = fundAmountMap.get(fund.ticker.toUpperCase());
                    const zakatableAmount =
                      investedAmount !== undefined && extrapolatedCriRatio !== null
                        ? investedAmount * extrapolatedCriRatio
                        : null;
                    const zakatDue =
                      zakatableAmount !== null ? zakatableAmount * ZAKAT_RATE : null;
                    const zakatableAmountDisplay = formatNumber(zakatableAmount, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    });
                    const zakatDueDisplay = formatNumber(zakatDue, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    });

                    return (


                      <div
                        key={fund.ticker}
                        className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
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
                              <span className="inline-flex items-center gap-1">
                                <span>Aggregate CRI / Price:</span>
                                <TooltipIcon text="Weighted average of holding CRI ratios using reported weights" />
                                <span>{formatRatio(aggregateCriRatio)}</span>
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <span>Weight coverage:</span>
                                <TooltipIcon text="Sum of holding weights included in the calculation" />
                                <span>
                                  {totalWeightCovered !== null && totalWeightCovered !== undefined
                                    ? formatRatio(totalWeightCovered)
                                    : "-"}
                                </span>
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <span>Extrapolated CRI / Price:</span>
                                <TooltipIcon text="Aggregate CRI / Price ÷ Weight coverage" />
                                <span>
                                  {extrapolatedCriRatio !== null
                                    ? formatRatio(extrapolatedCriRatio)
                                    : "-"}
                                </span>
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <span>Zakatable amount:</span>
                                <TooltipIcon text="Invested amount x Extrapolated CRI / Price" />
                                <span>{zakatableAmountDisplay}</span>
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <span>Zakat due:</span>
                                <TooltipIcon text="Zakatable amount x 2.5%" />
                                <span>{zakatDueDisplay}</span>
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className={downloadButtonClasses}
                            onClick={() => handleDownloadFundHoldings(fund)}
                            disabled={fund.holdings.length === 0}
                          >
                            Download CSV
                          </button>
                        </div>
                        <div className="overflow-x-auto">
                          {visibleFundHoldingColumns.length > 0 ? (
                            <table className="min-w-full text-left text-xs text-slate-200">
                              <thead className="sticky top-0 z-10 bg-slate-900/80 uppercase tracking-wide text-slate-400 backdrop-blur">
                                <tr>
                                  {visibleFundHoldingColumns.map((column) => {
                                    const width =
                                      fundHoldingColumnConfig[column.id]?.width ?? column.defaultWidth;
                                    const headerClasses = joinClasses("px-3 py-2", column.headerClassName);
                                    return (
                                      <th
                                        key={column.id}
                                        className={headerClasses}
                                        style={{ width, minWidth: width }}
                                      >
                                        <span className="inline-flex items-center gap-1">
                                          <span>{column.label}</span>
                                          {column.tooltip ? <TooltipIcon text={column.tooltip} /> : null}
                                        </span>
                                      </th>
                                    );
                                  })}
                                </tr>
                              </thead>
                              <tbody>
                                {fund.holdings
                                  .slice()
                                  .sort((a, b) => {
                                    const weightA =
                                      typeof a.weight === "number" ? a.weight : Number.NEGATIVE_INFINITY;
                                    const weightB =
                                      typeof b.weight === "number" ? b.weight : Number.NEGATIVE_INFINITY;
                                    return weightB - weightA;
                                  })
                                  .map((holding, idx) => {
                                    const rowKey = `${fund.ticker}-${getFundHoldingLabel(holding)}-${idx}`;
                                    return (
                                      <tr
                                        key={rowKey}
                                        className="border-b border-slate-800/70 bg-slate-900/40"
                                      >
                                        {visibleFundHoldingColumns.map((column) => {
                                          const width =
                                            fundHoldingColumnConfig[column.id]?.width ?? column.defaultWidth;
                                          const cellClasses = joinClasses("px-3 py-2", column.cellClassName);
                                          const cellTitle = column.cellTooltip?.(holding);
                                          return (
                                            <td
                                              key={column.id}
                                              className={cellClasses}
                                              style={{ width, minWidth: width }}
                                              title={cellTitle}
                                            >
                                              {column.renderCell(holding)}
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          ) : (
                            <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300">
                              Select at least one column to display holdings.
                            </div>
                          )}
                        </div>
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
                            ) : null
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            )}

          </section>
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-6 text-sm text-slate-400">
            {activeTab === "portfolio"
              ? "Add company tickers to see portfolio CRI results."
              : "Add fund tickers to see fund holdings and CRI metrics."}
          </div>
        )}
        </div>

        {sidebarOpen && (
        <aside className="flex flex-col gap-6 lg:w-64 lg:shrink-0">
          <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5 text-xs text-slate-300 shadow-lg shadow-slate-950/30">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Theme
            </span>
            <div
              role="group"
              aria-label="Color theme"
              className="mt-3 flex rounded-full border border-slate-700 bg-slate-950/60 p-1"
            >
              <button
                type="button"
                aria-pressed={theme === "light"}
                onClick={() => setTheme("light")}
                className={themeButtonClasses("light")}
              >
                Light
              </button>
              <button
                type="button"
                aria-pressed={theme === "mid"}
                onClick={() => setTheme("mid")}
                className={themeButtonClasses("mid")}
              >
                Mid
              </button>
              <button
                type="button"
                aria-pressed={theme === "dark"}
                onClick={() => setTheme("dark")}
                className={themeButtonClasses("dark")}
              >
                Dark
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm text-amber-100 shadow-lg shadow-amber-900/20">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-amber-200">
                <span className="text-base font-semibold uppercase tracking-wide text-amber-100">
                  Service Limits
                </span>
                <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                  Heads up
                </span>
              </div>
              <p className="text-[13px] leading-relaxed text-amber-100">
                We use Alpha Vantage&apos;s free API tier, which allows only 5 calls per minute.
                To avoid getting rate-limited, the app pauses briefly every five requests&mdash;
                especially noticeable while expanding funds/ETFs because each holding triggers its own call.
              </p>
              <p className="text-[13px] leading-relaxed text-amber-100">
                For faster refreshes you can swap in your own premium key in the backend
                environment variables.
              </p>
              <button
                type="button"
                onClick={() => setServiceDetailsOpen((open) => !open)}
                className="w-full rounded-md border border-amber-400/50 px-4 py-2 text-xs font-semibold text-amber-100 transition hover:border-amber-300 hover:text-white"
                aria-expanded={serviceDetailsOpen}
              >
                {serviceDetailsOpen ? "Hide platform & services" : "View platform & services"}
              </button>
            </div>
            {serviceDetailsOpen && (
              <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-[13px] text-amber-50">
                <p className="mb-2 font-semibold text-amber-100">What powers this app:</p>
                <ul className="list-disc space-y-1 pl-5 text-amber-50">
                  <li>Market & fundamental data: Alpha Vantage (free tier, 5 calls/min, 500/day).</li>
                  <li>Backend service: FastAPI app (`backend/main.py`) that orchestrates data pulls and valuation logic.</li>
                  <li>Frontend experience: Next.js 15 + React 19 UI (this dashboard) with Tailwind CSS 4.</li>
                  <li>Local orchestration: Docker Compose option for running backend + frontend together.</li>
                </ul>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/40">
            <div className="flex flex-col gap-2">
              <h2 className="text-base font-semibold text-slate-100">Instructions & Data Pipeline</h2>
              <p className="text-xs text-slate-400">
                Learn how to use the tool and how we source CRI metrics, fund holdings, and zakat estimates.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setInstructionsOpen((previous) => {
                  const next = !previous;
                  if (!previous) {
                    setInstructionsError(null);
                  }
                  return next;
                });
              }}
              className="mt-4 w-full rounded-md border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-sky-400 hover:text-sky-200"
            >
              {instructionsOpen ? "Hide Instructions" : "View Instructions"}
            </button>
            {instructionsOpen && (
              <div className="mt-4 rounded-xl border border-slate-800/70 bg-slate-950/70 p-4 text-sm text-slate-200">
                {instructionsLoading && (
                  <div className="mb-3 text-xs text-slate-400">Loading guide…</div>
                )}
                {instructionsError && (
                  <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-amber-300">
                    <span>{instructionsError}</span>
                    <button
                      type="button"
                      className="rounded-md border border-amber-500/60 px-3 py-1 text-[11px] font-semibold text-amber-200 transition hover:border-amber-400 hover:text-amber-100"
                      onClick={() => {
                        setInstructionsError(null);
                        setInstructionsContent(null);
                      }}
                    >
                      Try again
                    </button>
                    <a
                      href="/usage-guide.md"
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-sky-400 hover:text-sky-200"
                    >
                      Open in new tab
                    </a>
                  </div>
                )}
                {instructionsContent && (
                  <div className="max-h-[360px] overflow-y-auto rounded-lg border border-slate-800/50 bg-slate-900/70 p-4">
                    <ReactMarkdown components={markdownComponents}>
                      {instructionsContent}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            )}
          </section>
        </aside>
        )}
      </main>
    </div>
  );
}
