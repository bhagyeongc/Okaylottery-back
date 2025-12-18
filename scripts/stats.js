import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GAMES = ["megamillions", "powerball"];

// Configuration
const CONFIG = {
  // Number range and special ball range
  megamillions: { min: 1, max: 70, specialMin: 1, specialMax: 25, pick: 5 },
  powerball: { min: 1, max: 69, specialMin: 1, specialMax: 26, pick: 5 }
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// --- Statistical Helper Classes ---

class FrequencyStats {
  constructor(game) {
    this.game = game;
    this.ranges = CONFIG[game];
    this.counts = {}; // { period: { num: count } }
    this.periods = [
      { id: "all", label: "Since 2023", days: Infinity },
      { id: "2yr", label: "Recent 2 Years", days: 730 },
      { id: "1yr", label: "Recent 1 Year", days: 365 },
      { id: "6mo", label: "Recent 6 Months", days: 180 },
      { id: "100draws", label: "Last 100 Draws", count: 100 },
      { id: "50draws", label: "Last 50 Draws", count: 50 },
      { id: "10draws", label: "Last 10 Draws", count: 10 }, // Hot
      { id: "5draws", label: "Last 5 Draws", count: 5 }    // Creating Trends
    ];
  }

  process(draws) {
    const result = {};
    const today = new Date();

    this.periods.forEach(p => {
      let subset = draws;
      if (p.count) {
        subset = draws.slice(0, p.count);
      } else if (p.days !== Infinity) {
        const cutoff = new Date();
        cutoff.setDate(today.getDate() - p.days);
        subset = draws.filter(d => new Date(d.drawDate) >= cutoff);
      }

      const freqs = {};
      // Initialize 0
      for(let i = this.ranges.min; i <= this.ranges.max; i++) freqs[i] = 0;

      subset.forEach(d => {
        d.numbers.forEach(n => {
            if (freqs[n] !== undefined) freqs[n]++;
        });
      });

      // Sort
      const sorted = Object.entries(freqs)
        .map(([num, count]) => ({ num: parseInt(num), count }))
        .sort((a, b) => b.count - a.count || a.num - b.num);

      result[p.id] = {
        label: p.label,
        totalDraws: subset.length,
        data: sorted, 
        top10: sorted.slice(0, 10),
        bottom10: sorted.slice(-10).reverse() // Least frequent
      };
    });
    return result;
  }
}

class GapStats {
  constructor(game) {
    this.ranges = CONFIG[game];
  }

  process(draws) {
    const gaps = {};
    // Init
    for(let i = this.ranges.min; i <= this.ranges.max; i++) {
        gaps[i] = { current: 0, max: 0, history: [] };
    }

    // Process from oldest to newest to track max gap correctly? 
    // Actually simplest is: Iterate new -> old to find current gap. 
    // To find max gap, we need full history scan.
    // Let's iterate NEWEST to OLDEST.
    
    const lastSeenIndex = {}; // num -> index of last appearance (0-based from newest)

    // 1. Current Gap
    // Iterate numbers to find their first appearance index
    for(let i = this.ranges.min; i <= this.ranges.max; i++) {
        const idx = draws.findIndex(d => d.numbers.includes(i));
        gaps[i].current = idx === -1 ? draws.length : idx; // If never seen, gap is total count
    }

    // 2. Max Gap & Average Interval
    // We can compute Average Interval = Total Draws / (Appearances + 1) roughly
    // Or (First Date - Last Date) / Appearances
    // Let's do Max Gap by iterating all draws
    for(let i = this.ranges.min; i <= this.ranges.max; i++) {
        let maxGap = 0;
        let lastIdx = -1;
        let appearances = 0;
        
        // Go from Oldest to Newest to measure gaps in chronological order
        // draws is Newest -> Oldest. So reverse it or iterate backwards.
        for (let idx = draws.length - 1; idx >= 0; idx--) {
             if (draws[idx].numbers.includes(i)) {
                 const gap = (lastIdx === -1) ? 0 : (lastIdx - idx - 1); // Gap since last see
                 // Wait, idx is getting smaller as we go newer.
                 // Correct logic:
                 // 2023-01-01 (idx 100) -> Num 5
                 // 2023-01-05 (idx 96) -> Num 5. Gap = 100 - 96 - 1 = 3 draws in between.
                 if (lastIdx !== -1) {
                     const gap = lastIdx - idx - 1;
                     if(gap > maxGap) maxGap = gap;
                 }
                 lastIdx = idx;
                 appearances++;
             }
        }
        
        // Check gap from last appearance to NOW (which is effectively index -1)
        // lastIdx is the index of most recent appearance (smallest index)
        if (lastIdx !== -1) {
             const finalGap = lastIdx; // Index 0 is latest. So if lastIdx=5, gap is 5.
             if (finalGap > maxGap) maxGap = finalGap;
        } else {
             // Never appeared
             maxGap = draws.length;
        }

        gaps[i].max = maxGap;
        gaps[i].appearances = appearances;
        
        // Probability Score (Due Index)
        // Simple algo: (Current Gap / Avg Interval) * 100
        const avgInterval = appearances > 0 ? (draws.length / appearances) : draws.length;
        gaps[i].avgInterval = parseFloat(avgInterval.toFixed(2));
        gaps[i].dueScore = parseFloat(((gaps[i].current / avgInterval) * 100).toFixed(1));
    }

    // Sort by Due Score (Top 15 ranking)
    const ranking = Object.entries(gaps)
        .map(([num, stat]) => ({ num: parseInt(num), ...stat }))
        .sort((a, b) => b.dueScore - a.dueScore);

    return {
        all: gaps,
        ranking: ranking.slice(0, 15)
    };
  }
}

class PatternStats {
    process(draws) {
        // Recent 50 only for trends
        const subset = draws.slice(0, 50);
        
        const oddEven = { label: "Odd/Even", history: [] };
        const highLow = { label: "High/Low", history: [] }; // High >= 36 (Mega), 35 (PB) roughly. Let's say Mid point.
        const sumDist = { label: "Sum", history: [] };
        
        subset.forEach(d => {
            const nums = d.numbers;
            const odd = nums.filter(n => n % 2 !== 0).length;
            const even = nums.length - odd;
            
            // High/Low boundary. 70/2 = 35. 69/2 = 34.5. Let's use 35 as cut-off (1-35 Low, 36+ High)
            const high = nums.filter(n => n > 35).length;
            const low = nums.length - high;
            
            const sum = nums.reduce((a, b) => a + b, 0);

            oddEven.history.push({ date: d.drawDate, odd, even });
            highLow.history.push({ date: d.drawDate, high, low });
            sumDist.history.push({ date: d.drawDate, sum });
        });

        return {
            oddEven,
            highLow,
            sumDist
        };
    }
}

class PairStats {
    constructor(game) {
        this.ranges = CONFIG[game];
    }
    process(draws) {
        // Warning: O(N^2 * Draws) - computationally heavy if standard pairs.
        // N=70. 70*70 = 4900 pairs. * 150 draws = 735,000 ops. Fast enough.
        
        const pairs = {}; // "1-2": count
        
        draws.forEach(d => {
            const nums = d.numbers.slice().sort((a, b) => a - b);
            for (let i = 0; i < nums.length; i++) {
                for (let j = i + 1; j < nums.length; j++) {
                    const key = `${nums[i]}-${nums[j]}`;
                    pairs[key] = (pairs[key] || 0) + 1;
                }
            }
        });

        // Convert to array and sort
        const sortedPairs = Object.entries(pairs)
            .map(([key, count]) => ({ pair: key, count }))
            .sort((a, b) => b.count - a.count);

        return {
            bestPairs: sortedPairs.slice(0, 20),
            // Worst pairs is just those with count 0 or 1, huge list, maybe not useful to dump all
        };
    }
}

class SpecialStats {
    constructor(game) {
        this.game = game;
        this.ranges = CONFIG[game];
    }
    process(draws) {
        const freqs = {};
        for(let i = this.ranges.specialMin; i <= this.ranges.specialMax; i++) freqs[i] = 0;
        
        draws.forEach(d => {
             const sb = d.megaBall || d.powerBall;
             if(sb) freqs[sb] = (freqs[sb] || 0) + 1;
        });
        
        const sorted = Object.entries(freqs)
            .map(([num, count]) => ({ num: parseInt(num), count }))
            .sort((a, b) => b.count - a.count);

        // Gap analysis for Special Ball
        const gaps = {};
        for(let i = this.ranges.specialMin; i <= this.ranges.specialMax; i++) {
            const idx = draws.findIndex(d => (d.megaBall === i || d.powerBall === i));
            gaps[i] = idx === -1 ? draws.length : idx;
        }
        
        const sortedGaps = Object.entries(gaps)
            .map(([num, gap]) => ({ num: parseInt(num), gap }))
            .sort((a, b) => b.gap - a.gap);

        return {
            frequency: sorted,
            gaps: sortedGaps
        };
    }
}

class PredictionStats {
    constructor(game) {
        this.ranges = CONFIG[game];
    }
    
    process(freqData, gapData) {
        // Hot Picks: Top 5 from "Last 10 Draws" (Instant Hot)
        const hot = freqData['10draws'].top10.slice(0, 5).map(x => x.num);
        
        // Due Picks: Top 5 by Due Score (Gap analysis)
        const due = gapData.ranking.slice(0, 5).map(x => x.num);
        
        return {
            hotAndReady: hot,
            overdue: due
        };
    }
}


// --- Main Execution ---

async function run(game) {
    console.log(`Generating stats for ${game}...`);
    const dataDir = path.join(__dirname, `../data/${game}`);
    const statsDir = path.join(dataDir, "stats");
    ensureDir(statsDir);

    // 1. Load Data
    const indexPath = path.join(dataDir, "index.json");
    if (!fs.existsSync(indexPath)) {
        console.error("Index not found.");
        return;
    }
    const index = JSON.parse(fs.readFileSync(indexPath));
    const draws = [];
    
    // Sort draws: Newest first (index is already sorted descending usually, but ensure it)
    index.draws.forEach(dateStr => {
        const p = path.join(dataDir, `${dateStr}.json`);
        if (fs.existsSync(p)) {
            const d = JSON.parse(fs.readFileSync(p));
            // Only process if numbers exist
            if (d.numbers && d.numbers.length > 0) {
                draws.push(d);
            }
        }
    });

    if (draws.length === 0) return;

    // 2. Process
    const freqStats = new FrequencyStats(game).process(draws);
    const gapStats = new GapStats(game).process(draws);
    const patternStats = new PatternStats().process(draws);
    const pairStats = new PairStats(game).process(draws);
    const specialStats = new SpecialStats(game).process(draws);
    const predictionStats = new PredictionStats(game).process(freqStats, gapStats);

    // 3. Write Fragmented JSONs
    fs.writeFileSync(path.join(statsDir, "frequency.json"), JSON.stringify(freqStats, null, 2));
    fs.writeFileSync(path.join(statsDir, "gaps.json"), JSON.stringify(gapStats, null, 2));
    fs.writeFileSync(path.join(statsDir, "patterns.json"), JSON.stringify(patternStats, null, 2));
    fs.writeFileSync(path.join(statsDir, "pairs.json"), JSON.stringify(pairStats, null, 2));
    fs.writeFileSync(path.join(statsDir, "special.json"), JSON.stringify(specialStats, null, 2));
    fs.writeFileSync(path.join(statsDir, "predictions.json"), JSON.stringify(predictionStats, null, 2));

    console.log(`✅ Stats generated for ${game} in ${statsDir}`);
}

// CLI
const targetGame = process.argv[2];
if (targetGame && GAMES.includes(targetGame)) {
    run(targetGame);
} else {
    // If no arg, run both if manual
    GAMES.forEach(g => run(g));
}
