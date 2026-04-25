/**
 * Valuation Logic for KairoForge
 * Implements Graham Number and DCF Intrinsic Value
 */

export interface StockData {
  ticker: string;
  price: number;
  eps: number;
  bookValue: number;
  pe: number;
  marketCap: number;
  roe?: number;
  margins?: number;
  dividendYield?: number;
}

/**
 * Graham Number calculation
 * Graham Number = sqrt(22.5 * EPS * Book Value)
 */
export function calculateGrahamNumber(eps: number, bookValue: number): number | null {
  if (eps <= 0 || bookValue <= 0) return null;
  return Math.sqrt(22.5 * eps * bookValue);
}

/**
 * Simple DCF calculation (simplified for terminal usage)
 * Assumes 5 years of growth, then terminal growth
 */
export function calculateDCF(eps: number, growthRate: number = 0.15, discountRate: number = 0.12, terminalGrowth: number = 0.04): number | null {
  if (eps <= 0) return null;
  
  let intrinsicValue = 0;
  let currentEPS = eps;
  
  // Projection for 5 years
  for (let i = 1; i <= 5; i++) {
    currentEPS *= (1 + growthRate);
    intrinsicValue += currentEPS / Math.pow(1 + discountRate, i);
  }
  
  // Terminal Value (Gordon Growth Model)
  const terminalValue = (currentEPS * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  const discountedTerminalValue = terminalValue / Math.pow(1 + discountRate, 5);
  
  return intrinsicValue + discountedTerminalValue;
}

/**
 * Value Opportunity Score (0-100)
 */
export function calculateOpportunityScore(
  price: number, 
  dcfVal: number | null, 
  grahamVal: number | null, 
  roe: number = 0, 
  margins: number = 0,
  pe: number = 50
): number {
  let score = 0;
  
  // 1. DCF Margin of Safety (30 pts)
  if (dcfVal && dcfVal > price) {
    const mos = (dcfVal - price) / dcfVal;
    score += Math.min(30, mos * 60); // 50% MOS = 30 pts
  }
  
  // 2. Graham MOS (20 pts)
  if (grahamVal && grahamVal > price) {
    const mos = (grahamVal - price) / grahamVal;
    score += Math.min(20, mos * 40); // 50% MOS = 20 pts
  }
  
  // 3. Profitability (20 pts)
  // ROE > 20% is good
  score += Math.min(10, (roe * 100) / 2); // 20% ROE = 10 pts
  // Net Margins > 15% is good
  score += Math.min(10, (margins * 100) / 1.5); // 15% Margin = 10 pts
  
  // 4. Relative Valuation (15 pts)
  // Lower PE is better (cap at 40)
  if (pe < 40) {
    score += Math.max(0, (40 - pe) * (15 / 30)); // PE 10 = 15 pts
  }
  
  // 5. Data quality (15 pts) - Assumed for simplicity as consistently available data
  score += 15;
  
  return Math.min(100, Math.round(score));
}
