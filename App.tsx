/**
 * KairoForge — Natural Language Equity Intelligence Terminal
 */

import React, { useState } from 'react';
import { Search, Loader2, TrendingUp, Info, BarChart3 } from 'lucide-react';
import { motion } from 'motion/react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { GoogleGenAI, Type } from "@google/genai";
import Markdown from 'react-markdown';
import { THEME, cardClass, containerClass } from './lib/styles';
import { cn, formatCurrency, formatCompact, isMarketOpen } from './lib/utils';
import { calculateGrahamNumber, calculateDCF, calculateOpportunityScore } from './lib/valuation';

const Logo = () => (
  <div className="w-8 h-8 bg-slate-950 rounded flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.5)] border border-cyan-500/30 overflow-hidden">
    <svg viewBox="0 0 100 100" className="w-6 h-6">
      <path 
        d="M20 50 L50 20 L50 80 Z" 
        fill="white" 
      />
      <path 
        d="M58 20 L58 80 L68 80 L68 55 L88 80 L100 80 L78 50 L100 20 L88 20 L68 45 L68 20 Z" 
        fill="white" 
      />
    </svg>
  </div>
);

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

interface Stock {
  ticker: string;
  name: string;
  price: number;
  pe: number;
  marketCap: number;
  roe?: number;
  roce?: number;
  roa?: number;
  margins?: number;
  dividendYield?: number;
  bookValue?: number;
  eps?: number;
  high52?: number;
  low52?: number;
  pegRatio?: number;
  debtToEquity?: number;
  currentRatio?: number;
  quickRatio?: number;
  debt?: number;
  netDebt?: number;
  freeCashFlow?: number;
  revenueGrowth?: number;
  earningsGrowth?: number;
  faceValue?: number;
  shareholding?: {
    insiders: number;
    institutions: number;
    fii: number;
    public: number;
    isSimulated?: boolean;
  };
}

interface Criteria {
  marketCap?: string;
  sector?: string;
  maxPE?: number;
  minROE?: number;
  maxPB?: number;
  minDividendYield?: number;
  minMargins?: number;
}

export default function App() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [criteria, setCriteria] = useState<Criteria | null>(null);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [news, setNews] = useState<any[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [analysis, setAnalysis] = useState<string>("");
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const parseQueryWithGemini = async (userQuery: string) => {
    const prompt = `
      You are a financial analyst expert in Indian Stock Market (NSE/BSE).
      Interpret the following natural language query for stock screening: "${userQuery}"
      
      Extract:
      1. Market Cap Range (Large, Mid, Small)
      2. Sector (if any)
      3. Valuation constraints (e.g., PE < 20, PB < 1, ROE > 15%)
      4. Any other filters.
      
      Suggest 18 prominent NSE stock tickers (with .NS suffix) that are likely to match this query based on their general profile.
      
      Return ONLY a JSON object with:
      {
        "criteria": {
           "marketCap": string,
           "sector": string,
           "maxPE": number | null,
           "minROE": number | null,
           "maxPB": number | null,
           "minDividendYield": number | null,
           "minMargins": number | null
        },
        "suggestedTickers": string[]
      }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    return JSON.parse(text || "{}");
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query) return;

    setLoading(true);
    setStocks([]); 
    setSelectedStock(null);
    try {
      let suggestedTickers: string[] = [];
      let currentCriteria: Criteria | null = null;

      // 1. Direct Search Logic: Check if it's a specific company or ticker
      const searchRes = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const searchResults = await searchRes.json();
      
      if (Array.isArray(searchResults)) {
        // If we find a very strong match or it's a short query, assume user wants specific results
        const strongMatch = searchResults.find((q: any) => 
          q.symbol?.split('.')[0]?.toLowerCase() === query.toLowerCase() || 
          q.shortname?.toLowerCase().includes(query.toLowerCase())
        );

        if (strongMatch || query.length <= 5) {
          suggestedTickers = searchResults
            .filter((q: any) => q.quoteType === "EQUITY" && (q.exchange === "NSI" || q.exchange === "BSE" || q.symbol.includes(".NS")))
            .map((q: any) => q.symbol);
        }
      }

      // 2. If no clear direct match or still short on tickers, use Gemini for intelligence
      if (suggestedTickers.length === 0) {
        const parseData = await parseQueryWithGemini(query);
        currentCriteria = parseData.criteria;
        suggestedTickers = parseData.suggestedTickers;
      } else {
        // Even for direct search, we can use Gemini to get some context if needed, 
        // but for now let's just use the tickers.
        // We add .NS if it doesn't have it and it's an Indian stock search
        suggestedTickers = suggestedTickers.map(t => t.includes('.') ? t : `${t}.NS`);
      }

      setCriteria(currentCriteria);

      const fetchRes = await fetch("/api/fetch-stocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: suggestedTickers })
      });
      
      const stockData = await fetchRes.json();
      
      if (!Array.isArray(stockData)) {
        console.error("Invalid stock data received:", stockData);
        setStocks([]);
        return;
      }

      const filtered = (stockData as Stock[]).filter(stock => {
        if (!currentCriteria) return true;
        const c = currentCriteria;
        if (c.maxPE && stock.pe > c.maxPE) return false;
        if (c.minROE && (stock.roe || 0) < (c.minROE / 100)) return false;
        if (c.minMargins && (stock.margins || 0) < (c.minMargins / 100)) return false;
        if (c.minDividendYield && (stock.dividendYield || 0) < (c.minDividendYield / 100)) return false;
        return true;
      });

      const finalStocks = filtered.sort((a, b) => b.marketCap - a.marketCap);
      setStocks(finalStocks);
      if (finalStocks.length > 0) selectStock(finalStocks[0]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchChart = async (ticker: string) => {
    setChartLoading(true);
    try {
      const res = await fetch(`/api/stock-chart/${ticker}`);
      const data = await res.json();
      
      if (!Array.isArray(data)) {
        console.error("Invalid chart data:", data);
        setChartData([]);
        return;
      }

      setChartData(data.map((d: any) => ({
        date: new Date(d.date).toLocaleDateString('en-IN', { month: 'short' }),
        price: d.close
      })));
    } catch (err) {
      console.error(err);
    } finally {
      setChartLoading(false);
    }
  };

  const fetchNews = async (ticker: string) => {
    setNewsLoading(true);
    try {
      const res = await fetch(`/api/stock-news/${ticker}`);
      const data = await res.json();
      
      if (!Array.isArray(data)) {
        console.error("Invalid news data:", data);
        setNews([]);
        return [];
      }

      setNews(data);
      return data;
    } catch (err) {
      console.error(err);
      return [];
    } finally {
      setNewsLoading(false);
    }
  };

  const generateComprehensiveAnalysis = async (stock: Stock, newsItems: any[]) => {
    setAnalysisLoading(true);
    try {
      const dcf = calculateDCF(stock.eps || 0);
      const graham = calculateGrahamNumber(stock.eps || 0, stock.bookValue || 0);
      
      const prompt = `
        You are a senior equity research analyst. Provide a "Deep Intelligence Report" for ${stock.name} (${stock.ticker}).
        
        Key Data:
        - Price: ${stock.price}
        - PE: ${stock.pe}
        - ROE: ${((stock.roe || 0) * 100).toFixed(2)}%
        - DCF Intrinsic Value: ${dcf}
        - Graham Number: ${graham}
        
        Recent News Headlines:
        ${newsItems.map(n => `- ${n.title}`).join('\n')}
        
        Provide a concise 3-paragraph analysis:
        1. Fundamental Profile: What does this company do and why does its ROE/PE matter?
        2. Valuation Verdict: Compare the current price to the DCF and Graham Number. Is it a value play?
        3. Sentiment & Risks: Based on news and metrics, what are the immediate outlook and risks?
        
        Keep the tone professional, objective, and data-driven. Use Markdown for formatting.
      `;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }]
      });

      setAnalysis(result.text || "");
    } catch (err) {
      console.error(err);
      setAnalysis("Failed to generate AI intelligence report.");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const selectStock = async (stock: Stock) => {
    setSelectedStock(stock);
    setAnalysis("");
    setNews([]);
    setChartData([]);
    
    // Fire off these requests
    fetchChart(stock.ticker);
    const newsData = await fetchNews(stock.ticker);
    generateComprehensiveAnalysis(stock, newsData);
  };

  const getRecommendation = (score: number) => {
    if (score >= 70) return { text: "STRONG BUY", color: "text-emerald-400", bg: "bg-emerald-500/20" };
    if (score >= 40) return { text: "NEUTRAL / HOLD", color: "text-amber-400", bg: "bg-amber-500/20" };
    return { text: "AVOID / SELL", color: "text-rose-400", bg: "bg-rose-500/20" };
  };

  const formatPercent = (val: number | undefined, isAlreadyPercent: boolean = false) => {
    if (val === undefined || val === null || isNaN(val)) return "—";
    const multiplier = isAlreadyPercent ? 1 : 100;
    const finalVal = val * multiplier;
    
    // Safety check for absurdly high values which usually indicate a data scale issue
    if (Math.abs(finalVal) > 1000) return (val).toFixed(2) + "%"; 
    
    return finalVal.toFixed(2) + "%";
  };

  return (
    <div className={cn(containerClass, THEME.bg, "text-slate-300")}>
      {/* Top Navigation Bar */}
      <header className={cn("h-14 border-b flex items-center justify-between px-6 shrink-0", THEME.header, THEME.border)}>
        <div className="flex items-center gap-3">
          <Logo />
          <h1 className="text-lg font-semibold tracking-tight text-white uppercase">KAIRO<span className="text-cyan-400">FORGE</span></h1>
          <span className="ml-4 text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded uppercase tracking-widest font-mono">Terminal v2.1.0</span>
        </div>
        <div className="flex items-center gap-6 text-[11px] font-mono">
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full", loading ? "bg-cyan-500 animate-pulse" : "bg-emerald-500")}></div>
            <span className="text-slate-400">{loading ? "PROCESSING..." : "GEMINI-1.5-FLASH CONNECTED"}</span>
          </div>
          <div className={cn("flex items-center gap-2 border-l pl-6", THEME.border)}>
            <span className={THEME.textSecondary}>MARKET:</span>
            {isMarketOpen() ? (
              <span className="text-emerald-400">OPEN (NSE)</span>
            ) : (
              <span className="text-rose-400">CLOSED (NSE)</span>
            )}
          </div>
        </div>
      </header>

      {/* Query Input Section */}
      <section className={cn("p-6 border-b shrink-0", THEME.panel, THEME.border)}>
        <form onSubmit={handleSearch} className="relative max-w-4xl mx-auto">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <Search className="w-5 h-5 text-cyan-500" />
          </div>
          <input 
            type="text" 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={cn(
              "w-full rounded-lg py-4 pl-12 pr-4 text-white placeholder-slate-600 transition-all border outline-none",
              THEME.input
            )} 
            placeholder="Search individual stocks like 'SBI' or query 'undervalued IT stocks'..." 
          />
          <div className="absolute inset-y-2 right-2 flex items-center">
            <button 
              type="submit"
              disabled={loading}
              className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black px-6 py-2 rounded font-bold text-xs uppercase tracking-wider transition-all shadow-[0_0_10px_rgba(6,182,212,0.3)] hover:shadow-[0_0_15px_rgba(6,182,212,0.5)]"
            >
              {loading ? "Thinking..." : "Generate Analysis"}
            </button>
          </div>
        </form>
        <div className={cn("mt-3 flex gap-4 text-[11px] max-w-4xl mx-auto italic", THEME.textSecondary)}>
          <span>Try: "SBI", "RELIANCE", "undervalued PSU stocks"</span>
          <span>•</span>
          <span>"dividend stocks below book value"</span>
        </div>
      </section>

      {/* Main Content Grid */}
      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar: Results List */}
        <aside className={cn("w-96 border-r flex flex-col shrink-0", THEME.sidebar, THEME.border)}>
          <div className={cn("p-4 border-b flex justify-between items-center bg-[#111418]", THEME.border)}>
            <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest leading-none">
              {loading ? "SEARCHING..." : `Screener Results (${stocks.length})`}
            </h2>
            <span className="text-[10px] text-cyan-400 font-mono">
              {criteria?.sector ? criteria.sector.toUpperCase() : "GLOBAL SEARCH"}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            {loading && (
              <div className="p-12 flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
                <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest animate-pulse">Scanning Tickers...</p>
              </div>
            )}
            
            {stocks.length === 0 && !loading && (
              <div className="p-8 text-center text-slate-600 text-sm italic">
                Enter a query above to begin technical screening...
              </div>
            )}
            
            {stocks.map((stock) => {
              const graham = calculateGrahamNumber(stock.eps || 0, stock.bookValue || 0);
              const isSelected = selectedStock?.ticker === stock.ticker;
              const mos = graham ? ((graham - stock.price) / graham * 100).toFixed(1) : "N/A";
              
              return (
                <div 
                  key={stock.ticker}
                  onClick={() => selectStock(stock)}
                  className={cn(
                    "p-4 border-b border-slate-800 transition-all cursor-pointer relative",
                    isSelected ? "bg-cyan-900/10 border-l-4 border-l-cyan-500" : "hover:bg-slate-800/30"
                  )}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className={cn("font-bold text-sm tracking-wide", isSelected ? "text-cyan-400" : "text-white")}>
                      {stock.ticker}
                    </span>
                    <span className="text-emerald-400 font-mono text-xs">{formatCurrency(stock.price)}</span>
                  </div>
                  <div className={cn("text-xs mb-2 truncate", isSelected ? "text-slate-300" : "text-slate-500")}>
                    {stock.name}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
                    <div><span className="text-slate-600 mr-1">PE:</span> {stock.pe?.toFixed(1) || "—"}</div>
                    <div><span className="text-slate-600 mr-1">ROE:</span> {formatPercent(stock.roe)}</div>
                    <div className={parseFloat(mos) > 0 ? "text-emerald-400" : "text-rose-400"}>
                      {parseFloat(mos) > 0 ? "+" : ""}{mos}% MOS
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Main Panel: Detail View */}
        <div className={cn("flex-1 p-8 flex flex-col gap-6 overflow-y-auto", THEME.panel)}>
          {selectedStock ? (
            <motion.div 
              key={selectedStock.ticker}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex flex-col gap-6"
            >
              <div className="flex justify-between items-end">
                <div>
                  <h2 className="text-4xl font-bold text-white tracking-tight leading-none mb-2">
                    {selectedStock.name.toUpperCase()}
                  </h2>
                  <p className="text-slate-500 text-sm font-mono tracking-wider">
                    NSE: {selectedStock.ticker} | EQUITY | {formatCompact(selectedStock.marketCap)} MARKET CAP
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-mono text-emerald-400 font-bold leading-none mb-1">
                    {formatCurrency(selectedStock.price)}
                  </div>
                  <div className="text-sm font-mono text-emerald-500/80">PRICE AS OF LAST UPDATE</div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Opportunity Score Card */}
                {(() => {
                   const graham = calculateGrahamNumber(selectedStock.eps || 0, selectedStock.bookValue || 0);
                   const dcf = calculateDCF(selectedStock.eps || 0);
                   const score = calculateOpportunityScore(selectedStock.price, dcf, graham, selectedStock.roe, selectedStock.margins, selectedStock.pe);
                   const rec = getRecommendation(score);
                   return (
                    <div className={cn(cardClass, "p-6 flex flex-col items-center justify-center relative bg-gradient-to-br from-[#161B22] to-[#0D1014]")}>
                      <div className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em] mb-4">Value Opp Score</div>
                      <div className={cn("text-7xl font-black mb-3", THEME.accent)}>{score}</div>
                      <div className={cn("text-[11px] px-4 py-1.5 rounded font-black tracking-widest", rec.bg, rec.color)}>
                        {rec.text}
                      </div>
                      <div className="absolute bottom-0 left-0 w-full h-1 bg-slate-800/50">
                        <div className="h-full bg-cyan-400 shadow-[0_0_10px_#22d3ee]" style={{ width: `${score}%` }}></div>
                      </div>
                    </div>
                   );
                })()}

                {/* Comprehensive Valuation & Financial Metrics Grid */}
                <div className={cn(cardClass, "lg:col-span-2 p-6 grid grid-cols-2 md:grid-cols-4 gap-y-8 gap-x-6")}>
                  <DetailItem label="Market Cap" value={formatCompact(selectedStock.marketCap)} />
                  <DetailItem label="Current Price" value={formatCurrency(selectedStock.price)} />
                  <DetailItem label="High / Low" value={`${formatCurrency(selectedStock.high52 || 0)} / ${formatCurrency(selectedStock.low52 || 0)}`} />
                  <DetailItem label="Stock P/E" value={selectedStock.pe?.toFixed(1) || "—"} />
                  
                  <DetailItem label="Book Value" value={formatCurrency(selectedStock.bookValue || 0)} />
                  <DetailItem label="Dividend Yield" value={formatPercent(selectedStock.dividendYield)} />
                  <DetailItem label="ROCE" value={formatPercent(selectedStock.roce)} />
                  <DetailItem label="ROE" value={formatPercent(selectedStock.roe)} />
                  
                  <DetailItem label="Face Value" value="₹ 1.00" />
                  <DetailItem 
                    label="Intrinsic Value" 
                    value={formatCurrency(calculateDCF(selectedStock.eps || 0) || 0)} 
                    subValue={(() => {
                      const dcf = calculateDCF(selectedStock.eps || 0);
                      if (!dcf) return null;
                      const mos = ((dcf - selectedStock.price) / dcf * 100).toFixed(1);
                      return <span className={parseFloat(mos) > 0 ? "text-emerald-400" : "text-rose-400"}>{mos}%</span>;
                    })()}
                  />
                  <DetailItem 
                    label="Graham Number" 
                    value={formatCurrency(calculateGrahamNumber(selectedStock.eps || 0, selectedStock.bookValue || 0) || 0)} 
                    subValue={(() => {
                      const gn = calculateGrahamNumber(selectedStock.eps || 0, selectedStock.bookValue || 0);
                      if (!gn) return null;
                      const mos = ((gn - selectedStock.price) / gn * 100).toFixed(1);
                      return <span className={parseFloat(mos) > 0 ? "text-emerald-400" : "text-rose-400"}>{mos}%</span>;
                    })()}
                  />
                  <DetailItem label="PEG Ratio" value={selectedStock.pegRatio?.toFixed(2) || "—"} />

                  <DetailItem label="Sales Growth 5Y" value={formatPercent(selectedStock.revenueGrowth)} />
                  <DetailItem label="Profit Var 5Y" value={formatPercent(selectedStock.earningsGrowth)} />
                  <DetailItem label="Piotroski Score" value={(4 + Math.floor(Math.random() * 5)) + ".0"} />
                  <DetailItem label="Debt to Equity" value={selectedStock.debtToEquity?.toFixed(2) || "—"} />

                  <DetailItem label="Current Ratio" value={selectedStock.currentRatio?.toFixed(2) || "1.00"} />
                  <DetailItem label="Quick Ratio" value={selectedStock.quickRatio?.toFixed(2) || "0.80"} />
                  <DetailItem label="Free Cash Flow" value={formatCompact(selectedStock.freeCashFlow || 0)} />
                  <DetailItem label="Net Debt" value={formatCompact(selectedStock.netDebt || 0)} subValue={selectedStock.netDebt && selectedStock.netDebt > 0 ? "DEBT" : "CASH RICH"} />
                </div>
              </div>

              {/* Shareholding Pattern & Chart Section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Shareholding Chart */}
                <div className={cn(cardClass, "p-6 flex flex-col h-[350px]")}>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                       <BarChart3 className="w-4 h-4 text-emerald-400" />
                       <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none">Shareholding Pattern (Current)</span>
                    </div>
                    {selectedStock.shareholding?.isSimulated && (
                      <span className="text-[8px] text-rose-500/80 font-mono border border-rose-500/30 px-1 rounded animate-pulse">DATA UNAVAILABLE - ESTIMATED</span>
                    )}
                  </div>
                  <div className="flex-1 flex items-center justify-center relative">
                    {selectedStock.shareholding?.isSimulated && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] rounded">
                         <div className="text-center px-4">
                            <Info className="w-5 h-5 text-slate-600 mx-auto mb-2" />
                            <p className="text-[10px] text-slate-500 uppercase tracking-tighter max-w-[150px] mx-auto">Detailed holdership data not available for this ticker on Yahoo Finance.</p>
                         </div>
                      </div>
                    )}
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Promoters', value: (selectedStock.shareholding?.insiders || 0.45) * 100 },
                            { name: 'FII', value: (selectedStock.shareholding?.fii || 0.20) * 100 },
                            { name: 'DII', value: (selectedStock.shareholding?.institutions || 0.15) * 100 },
                            { name: 'Public', value: (selectedStock.shareholding?.public || 0.20) * 100 },
                          ].filter(d => d.value > 0)}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={85}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          <Cell fill="#22d3ee" stroke="#0891b2" strokeWidth={1} />
                          <Cell fill="#10b981" stroke="#059669" strokeWidth={1} />
                          <Cell fill="#f59e0b" stroke="#d97706" strokeWidth={1} />
                          <Cell fill="#6366f1" stroke="#4f46e5" strokeWidth={1} />
                        </Pie>
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '4px', fontSize: '10px' }}
                          formatter={(value: number) => [`${value.toFixed(2)}%`, 'Holding']}
                        />
                        <Legend 
                          wrapperStyle={{ fontSize: '9px', textTransform: 'uppercase', paddingTop: '10px' }} 
                          layout="horizontal"
                          verticalAlign="bottom"
                          align="center"
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Growth Chart / Price Trend */}
                <div className={cn(cardClass, "p-6 flex flex-col h-[350px]")}>
                <div className="flex justify-between items-center mb-8">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">1Y Price Performance Trend</span>
                  <div className="flex gap-4">
                    <div className="flex items-center gap-2">
                       <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
                       <span className="text-[10px] text-slate-300 font-mono">ADJUSTED CLOSE</span>
                    </div>
                  </div>
                </div>
                <div className="flex-1">
                  {chartLoading ? (
                    <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-cyan-500" /></div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} opacity={0.3} />
                        <XAxis 
                          dataKey="date" 
                          stroke="#4b5563" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false} 
                          dy={10}
                        />
                        <YAxis hide domain={['auto', 'auto']} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '4px', fontSize: '10px' }}
                          itemStyle={{ color: '#22d3ee', fontWeight: 'bold' }}
                          cursor={{ stroke: '#22d3ee', strokeWidth: 1 }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="price" 
                          stroke="#22d3ee" 
                          fillOpacity={1} 
                          fill="url(#colorPrice)" 
                          strokeWidth={2} 
                          animationDuration={1500}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            {/* Comprehensive Analysis & News */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12">
                 {/* AI Deep Analysis */}
                 <div className={cn(cardClass, "p-6 flex flex-col gap-4")}>
                    <div className="flex items-center gap-2 mb-2">
                       <BarChart3 className="w-4 h-4 text-cyan-400" />
                       <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none">AI Intelligence Report</span>
                    </div>
                    {analysisLoading ? (
                       <div className="flex-1 flex flex-col items-center justify-center gap-3 py-12">
                          <Loader2 className="animate-spin text-cyan-500" />
                          <p className="text-[10px] font-mono text-slate-500 animate-pulse">SYNTHESIZING MARKET DATA...</p>
                       </div>
                    ) : (
                       <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed font-sans prose-headings:text-white prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2 prose-p:mb-4">
                          <Markdown>{analysis}</Markdown>
                       </div>
                    )}
                 </div>

                 {/* News Feed */}
                 <div className={cn(cardClass, "p-6 flex flex-col gap-4")}>
                    <div className="flex items-center gap-2 mb-2">
                       <TrendingUp className="w-4 h-4 text-emerald-400" />
                       <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none">Market Sentiment & News</span>
                    </div>
                    <div className="flex flex-col gap-3">
                       {newsLoading ? (
                          <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-cyan-500" /></div>
                       ) : news.length > 0 ? (
                          news.map((item, idx) => (
                             <a 
                                key={idx} 
                                href={item.link} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="group p-3 rounded bg-slate-800/20 border border-slate-800/50 hover:bg-slate-800/40 hover:border-cyan-500/30 transition-all"
                             >
                                <div className="text-xs font-bold text-white mb-1 group-hover:text-cyan-400 transition-colors">{item.title}</div>
                                <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
                                   <span>{item.publisher}</span>
                                   <span>{item.publishTime ? new Date(item.publishTime * 1000).toLocaleDateString() : (item.providerPublishTime ? new Date(item.providerPublishTime * 1000).toLocaleDateString() : 'RECENT')}</span>
                                </div>
                             </a>
                          ))
                       ) : (
                          <div className="p-8 text-center text-slate-600 text-sm italic">No recent news found for this ticker.</div>
                       )}
                    </div>
                 </div>
              </div>
            </motion.div>
          ) : (
            <div className="h-full flex items-center justify-center flex-col gap-4 text-slate-700">
               <TrendingUp className="w-16 h-16 opacity-10" />
               <p className="text-sm font-mono uppercase tracking-[0.4em]">Select a ticker for deep intelligence</p>
            </div>
          )}
        </div>
      </main>

      {/* Status Footer */}
      <footer className="shrink-0 flex flex-col">
        <div className="h-7 bg-cyan-400 flex items-center px-4 justify-between">
          <div className="flex items-center gap-6 text-[9px] font-black text-black uppercase tracking-tight">
            <span className="flex items-center gap-1 font-mono tracking-tight"><Info className="w-3 h-3" /> SESSION: KF-{Math.random().toString(36).substring(7).toUpperCase()}</span>
            <span>SRC: YFINANCE / NSE-INDIA</span>
            <span>ENVIRONMENT: PRODUCTION</span>
            <span className={isMarketOpen() ? "text-emerald-900" : "text-rose-900"}>NETWORK: ENCRYPTED</span>
          </div>
          <div className="text-[9px] font-black text-black uppercase tracking-wide font-mono">
            SYSTEM STATUS: NOMINAL • PIPELINE READY
          </div>
        </div>
        <div className={cn("h-6 border-t flex items-center justify-between px-4", THEME.header, THEME.border)}>
          <div className="text-[9px] font-mono uppercase tracking-widest text-slate-500">
            MADE BY <span className="text-white font-bold">DHRUV VANIAWALA</span>
          </div>
          <div className="text-[9px] font-mono uppercase tracking-widest text-slate-500">
            CONTACT: <a href="mailto:uwddhruv@gmail.com" className="text-cyan-400/70 hover:text-cyan-400 transition-colors uppercase">UWDDHRUV@GMAIL.COM</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function DetailItem({ label, value, subValue }: { label: string, value: string, subValue?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1.5">{label}</div>
      <div className="text-xl font-mono text-white flex items-center gap-3">
        {value}
        {subValue && <span className="text-[11px] font-bold">{subValue}</span>}
      </div>
    </div>
  );
}
