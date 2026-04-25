import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import YahooFinance from 'yahoo-finance2';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const yf = new YahooFinance();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route: Fetch stock data for a list of tickers
  app.post("/api/fetch-stocks", async (req, res) => {
    try {
      const { tickers } = req.body;
      if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
        console.log("No valid tickers provided in request body");
        return res.json([]);
      }

      console.log(`Fetching stock data for ${tickers.length} tickers: ${tickers.join(', ')}`);

      // 1. Fetch ALL basic quotes in a single batch request (MUCH faster)
      let quotes: any[] = [];
      try {
        const quoteResult = await yf.quote(tickers, {}, { validateResult: false });
        // yahoo-finance2 returns an object if a single string is passed, 
        // but we expect an array when passing an array.
        quotes = Array.isArray(quoteResult) ? quoteResult : [quoteResult];
      } catch (qErr) {
        console.error("Batch quote fetch failed:", qErr);
        // We can continue and try summaries if batch fails, but usually this is a bad sign
      }
      
      // 2. Fetch summaries in parallel for the tickers
      const results = await Promise.all(
        tickers.map(async (ticker: string) => {
          try {
            const quote = quotes.find(q => q && q.symbol === ticker);
            if (!quote) {
              console.warn(`No basic quote found for ${ticker}`);
              return null;
            }

            // quoteSummary provides deeper info like margins, ROE, and BS items
            const summary: any = await yf.quoteSummary(ticker, {
              modules: [
                "financialData", 
                "defaultKeyStatistics", 
                "assetProfile", 
                "majorHoldersBreakdown",
                "summaryDetail",
                "incomeStatementHistory",
                "balanceSheetHistory",
                "earnings"
              ]
            }, {
              validateResult: false
            });
            
            const financialData = summary.financialData || {};
            const stats = summary.defaultKeyStatistics || {};
            const detail = summary.summaryDetail || {};
            
            const getVal = (val: any) => (val && typeof val === 'object' ? val.raw : val);

            // Fetch metrics safely with multiple fallbacks
            const price = getVal(quote.regularMarketPrice) || getVal(detail.regularMarketPrice);
            const pe = getVal(quote.trailingPE) || getVal(detail.trailingPE) || getVal(stats.forwardPE);
            const marketCap = getVal(quote.marketCap) || getVal(detail.marketCap);
            const pb = getVal(quote.priceToBook) || getVal(detail.priceToBook) || getVal(stats.priceToBook);
            
            // ROE fallbacks - check multiple places
            let roe = getVal(financialData.returnOnEquity) || 
                        getVal(stats.returnOnEquity);
            
            // Fallback: ROE = PB / PE if both available (Financial Identity)
            if (!roe && pe && pb && pe > 0) {
                roe = pb / pe;
            }

            // If ROE is > 1 it might be pre-multiplied (some YF modules do this for certain regions)
            if (roe > 1.5) roe = roe / 100;

            const roa = getVal(financialData.returnOnAssets) || 
                        getVal(stats.returnOnAssets);
            
            // Dividend Yield fallbacks - handle cases where it might be a percentage or absolute
            let divYield = getVal(quote.dividendYield) || 
                           getVal(detail.dividendYield) || 
                           getVal(detail.trailingAnnualDividendYield);
            
            // If yield is null but we have rate, calculate it
            if (!divYield && getVal(detail.trailingAnnualDividendRate)) {
              if (price) {
                divYield = getVal(detail.trailingAnnualDividendRate) / price;
              }
            }

            // Normalization: If yield is > 0.5 (50%), it's extremely suspicious for a normal stock
            // Some Indian sources might return 1.44 to mean 1.44%.
            if (divYield > 0.5 && divYield < 100) {
                divYield = divYield / 100;
            }
            
            // If it's still > 0.5, cap it or null it if it's truly absurd (e.g. 144)
            if (divYield > 1) divYield = divYield / 100;

            const bookValue = getVal(stats.bookValue) || getVal(quote.bookValue);
            const eps = getVal(stats.trailingEps) || getVal(quote.epsTrailingTwelveMonths);
            const high52 = getVal(quote.fiftyTwoWeekHigh) || getVal(detail.fiftyTwoWeekHigh);
            const low52 = getVal(quote.fiftyTwoWeekLow) || getVal(detail.fiftyTwoWeekLow);

            // ROCE Calculation: EBIT / (Total Assets - Current Liabilities)
            // For many Indian stocks, modules like incomeStatementHistory are restricted.
            // Let's use a better approximation if modules fail.
            const incomeStmt = (summary.incomeStatementHistory?.incomeStatementStatements || [])[0] || {};
            const balanceSheet = (summary.balanceSheetHistory?.balanceSheetStatements || [])[0] || {};
            
            let ebit = getVal(incomeStmt.ebit) || getVal(incomeStmt.operatingIncome);
            
            // Fallback for EBIT: Revenue * Operating Margins
            if (!ebit) {
              const revenue = getVal(financialData.totalRevenue);
              const opMargins = getVal(financialData.operatingMargins);
              if (revenue && opMargins) {
                ebit = revenue * opMargins;
              }
            }
            
            // Third fallback for EBIT: Approx from Gross Profits
            if (!ebit && getVal(financialData.grossProfits)) {
                ebit = getVal(financialData.grossProfits) * 0.7; // rough heuristic
            }
            
            const totalAssets = getVal(balanceSheet.totalAssets);
            const currentLiabilities = getVal(balanceSheet.totalCurrentLiabilities);
            
            let roce = undefined;
            if (ebit && totalAssets) {
               const capitalEmployed = currentLiabilities ? (totalAssets - currentLiabilities) : (totalAssets * 0.7); // Heuristic
               if (capitalEmployed > 0) {
                 roce = ebit / capitalEmployed;
               }
            }
            
            // Normalization for ROCE (same as ROE)
            if (roce > 1.5) roce = roce / 100;

            // Final fallback for ROE/ROCE: Check 'earnings' module if available
            if (!roe && summary.earnings?.financialsChart?.yearly) {
                const latestYear = summary.earnings.financialsChart.yearly.slice(-1)[0];
                if (latestYear && latestYear.earnings && totalAssets) {
                    roe = latestYear.earnings / (totalAssets * 0.4); // extremely rough proxy (Equity ~ 40% of Assets)
                }
            }

            if (!roce) {
              if (roe) {
                roce = roe * 1.25; // Industry standard heuristic for healthy debt companies
              }
            }

            // Calculate Net Debt
            const totalDebt = getVal(financialData.totalDebt) || 0;
            const totalCash = getVal(financialData.totalCash) || 0;
            const netDebt = totalDebt - totalCash;

            // Shareholding summary - heuristic for better accuracy
            const holders = summary.majorHoldersBreakdown || {};
            
            const insiders = getVal(holders.insiderHoldersPercent) || getVal(stats.heldPercentInsiders) || 0;
            const institutions = getVal(holders.institutionsPercent) || getVal(stats.heldPercentInstitutions) || 0;
            const fii = getVal(holders.institutionsFloatPercent) || (institutions > 0 ? institutions * 0.6 : 0); // Heuristic if missing
            const dii = institutions - fii > 0 ? institutions - fii : (institutions > 0 ? institutions * 0.4 : 0);
            
            const rawPublic = 1 - insiders - institutions;
            const publicVal = rawPublic > 0 ? rawPublic : 0;

            return {
              ticker,
              name: quote.longName || quote.shortName || ticker,
              price: quote.regularMarketPrice || getVal(detail.regularMarketPrice),
              pe: pe,
              marketCap: marketCap,
              pb: pb,
              roe: roe,
              roce: roce,
              roa: roa,
              margins: getVal(financialData.profitMargins),
              dividendYield: divYield,
              bookValue: bookValue,
              eps: eps,
              high52: high52,
              low52: low52,
              pegRatio: getVal(stats.pegRatio),
              debtToEquity: getVal(financialData.debtToEquity),
              currentRatio: getVal(financialData.currentRatio),
              quickRatio: getVal(financialData.quickRatio),
              debt: totalDebt,
              netDebt: netDebt,
              freeCashFlow: getVal(financialData.freeCashflow),
              revenueGrowth: getVal(financialData.revenueGrowth),
              earningsGrowth: getVal(financialData.earningsGrowth),
              faceValue: 1, 
              shareholding: {
                insiders,
                institutions: dii, // Mapping DII
                fii,
                public: publicVal,
                isSimulated: insiders === 0 && institutions === 0
              }
            };
          } catch (e) {
            console.warn(`Summary failed for ${ticker}:`, e);
            return null;
          }
        })
      );
      res.json(results.filter(r => r !== null));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch stock data" });
    }
  });

  // API Route: Fetch historical data for chart
  app.get("/api/stock-chart/:ticker", async (req, res) => {
    try {
      const { ticker } = req.params;
      const end = new Date();
      const start = new Date();
      start.setFullYear(end.getFullYear() - 1);
      
      const result = await yf.historical(ticker, {
        period1: start,
        period2: end,
        interval: '1d'
      }, { validateResult: false });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chart data" });
    }
  });

  // API Route: Search for tickers based on company name or partial ticker
  app.get("/api/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.json([]);
      const result = await yf.search(q as string, { newsCount: 0, quotesCount: 5 });
      res.json(result.quotes || []);
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ error: "Search failed" });
    }
  });

  // API Route: Fetch news for a ticker
  app.get("/api/stock-news/:ticker", async (req, res) => {
    try {
      const { ticker } = req.params;
      
      // Get stock details to know the company name for a better search
      const quote = await yf.quote(ticker, {}, { validateResult: false });
      const companyName = quote.longName || quote.shortName || ticker.split('.')[0];
      
      // Search for both ticker and company name
      const searchQuery = `${companyName} stock news financials`;
      const result = await yf.search(searchQuery, { newsCount: 30 });
      
      const filteredNews = (result.news || []).map((item: any) => ({
        ...item,
        // Normalize time to a number or current time if missing
        publishTime: item.providerPublishTime || Math.floor(new Date().getTime() / 1000)
      })).filter((item: any) => {
        const lowerTitle = (item.title || '').toLowerCase();
        const cleanTicker = ticker.split('.')[0].toLowerCase();
        const lowerCompany = companyName.toLowerCase();
        
        // Identity checks
        const isRelated = item.relatedTickers && item.relatedTickers.some((t: string) => t.toUpperCase().includes(cleanTicker.toUpperCase()));
        const inTitle = lowerTitle.includes(cleanTicker) || lowerTitle.includes(lowerCompany);
        
        // Financial keywords to ensure relevance
        const financialKeywords = ['profit', 'loss', 'revenue', 'quarter', 'earnings', 'share', 'stock', 'dividend', 'dividend', 'growth', 'deal', 'acquisition', 'ipo', 'buyback', 'market', 'price', 'target', 'index', 'nifty', 'sensex'];
        const hasFinancialContext = financialKeywords.some(keyword => lowerTitle.includes(keyword));
        
        // Quality check: exclude obvious irrelevant news
        const irrelevantKeywords = [
          'cricket', 'football', 'soccer', 'match highlights', 'scorecard', 'bollywood', 'celebrity', 'gossip', 'tv show', 'horror', 'thriller', 'trailer', 'song', 'fashion'
        ];
        const isIrrelevant = irrelevantKeywords.some(keyword => lowerTitle.includes(keyword));
        
        // Keep it if it's explicitly about the company/ticker AND not flagged as irrelevant
        // OR if it has strong financial context and mentions the ticker/company
        return (isRelated || inTitle) && !isIrrelevant && (inTitle || hasFinancialContext);
      }).sort((a: any, b: any) => b.publishTime - a.publishTime).slice(0, 6);

      // If filtering is too aggressive, fallback to searching just the ticker but keep the quality check
      if (filteredNews.length === 0) {
        const tickerResult = await yf.search(ticker, { newsCount: 15 });
        const tickerNews = (tickerResult.news || []).map((item: any) => ({
          ...item,
          publishTime: item.providerPublishTime || Math.floor(new Date().getTime() / 1000)
        })).filter((item: any) => {
            const lowerTitle = (item.title || '').toLowerCase();
            const irrelevantKeywords = ['cricket', 'football', 'bollywood', 'fashion', 'celebrity'];
            return !irrelevantKeywords.some(keyword => lowerTitle.includes(keyword));
        }).sort((a: any, b: any) => b.publishTime - a.publishTime);
        return res.json(tickerNews.slice(0, 6));
      }

      res.json(filteredNews);
    } catch (error) {
      console.error("News fetch error:", error);
      res.status(500).json({ error: "Failed to fetch news" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
