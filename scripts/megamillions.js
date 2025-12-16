import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATA_DIR = path.join(__dirname, "../data/megamillions");

// Helper to convert JS Date to .NET Ticks
export function convertToNetTicks(dateObj) {
  const epochOffset = 621355968000000000n;
  const ticksPerMs = 10000n;
  const time = BigInt(dateObj.getTime());
  return (time * ticksPerMs) + epochOffset;
}

export function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function saveDraw(data) {
    const date = data.drawDate;
    
    fs.writeFileSync(
        path.join(DATA_DIR, `${date}.json`),
        JSON.stringify(data, null, 2)
    );

    const indexPath = path.join(DATA_DIR, "index.json");
    let index = { game: "megamillions", draws: [] };

    if (fs.existsSync(indexPath)) {
        index = JSON.parse(fs.readFileSync(indexPath));
    }

    if (!index.draws.includes(date)) {
        index.draws.push(date);
        index.draws.sort((a, b) => b.localeCompare(a));
    }

    index.total = index.draws.length;
    index.updatedAt = new Date().toISOString();

    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

function formatPrize(amount) {
    if (amount >= 1000000) {
      const inMillions = (amount / 1000000).toFixed(1).replace(/\.0$/, '');
      return `$${inMillions} Million`;
    } else if (amount >= 1000) {
      const inThousands = (amount / 1000).toFixed(1).replace(/\.0$/, '');
      return `$${inThousands},000`;
    } else {
      return `$${amount.toFixed(0)}`;
    }
}

// Video Feed Cache
let videoMapCache = null;

async function fetchVideoMap() {
    if (videoMapCache) return videoMapCache;
    videoMapCache = {};
    try {
        const res = await fetch("https://www.youtube.com/feeds/videos.xml?channel_id=UCOKAdrQ0sKR9H1hi88RmQkA");
        if(!res.ok) return videoMapCache;
        const txt = await res.text();
        
        // Simple regex parse to avoid deps
        const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
        let match;
        while ((match = entryRegex.exec(txt)) !== null) {
            const entryBlock = match[1];
            // Title format: MM12122025 -> MM + MM + DD + YYYY
            const titleMatch = entryBlock.match(/<title>MM(\d{2})(\d{2})(\d{4})<\/title>/);
            const idMatch = entryBlock.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
            
            if (titleMatch && idMatch) {
                const [_, m, d, y] = titleMatch;
                const dateKey = `${y}-${m}-${d}`; // ISO format YYYY-MM-DD
                videoMapCache[dateKey] = idMatch[1];
            }
        }
    } catch (e) {
        console.error("Failed to fetch video feed:", e.message);
    }
    return videoMapCache;
}

export async function fetchDrawByDate(dateStr, explicitTicks) {
    let ticks = explicitTicks;
    if (!ticks) {
        const dateObj = new Date(dateStr);
        ticks = convertToNetTicks(dateObj);
    }
    
    // console.log(`Fetching ${dateStr} with ticks: ${ticks}`);
    
    // Parallel fetch: data and video map
    // We don't want video fetch to block or fail the main data fetch deeply, 
    // but initializing the map once is fine.
    const [response, videoMap] = await Promise.all([
        fetch(`https://www.megamillions.com/cmspages/utilservice.asmx/GetDrawDataByTickWithMatrix?PlayDateTicks=${ticks}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://www.megamillions.com/Winning-Numbers/Previous-Drawings.aspx'
            }
        }),
        fetchVideoMap()
    ]);

    if (!response.ok) {
        throw new Error(`Failed to fetch from Mega Millions API: ${response.status}`);
    }

    const responseText = await response.text();
    // Start with XML check
    let jsonString = null;
    const jsonMatch = responseText.match(/<string[^>]*>([\s\S]*?)<\/string>/);
    
    if (jsonMatch && jsonMatch[1]) {
        jsonString = jsonMatch[1];
    } else {
        // Fallback: check if it is already JSON (some servers content-negotiate)
        try {
            JSON.parse(responseText);
            jsonString = responseText;
        } catch (e) {
            // Not JSON
        }
    }

    if (!jsonString) {
        const preview = responseText.slice(0, 200);
        throw new Error(`Could not extract JSON string from API response. Preview: ${preview}`);
    }

    const jsonData = JSON.parse(jsonString);
    
    // 1. Drawing Info
    const drawing = jsonData.Drawing;
    if (!drawing) return null;

    const winningNumbers = [drawing.N1, drawing.N2, drawing.N3, drawing.N4, drawing.N5];
    const megaBall = drawing.MBall;
    const megaplier = drawing.Megaplier; // Might be -1

    // 2. Jackpot Info
    let jackpotStr = "TBD";
    let cashValueStr = undefined;
    if (jsonData.Jackpot) {
        if (jsonData.Jackpot.CurrentPrizePool) {
             const val = jsonData.Jackpot.CurrentPrizePool;
             jackpotStr = formatPrize(val);
        }
        if (jsonData.Jackpot.CurrentCashValue) {
            const val = jsonData.Jackpot.CurrentCashValue;
            cashValueStr = formatPrize(val);
        }
    }

    // 3. Prize Tiers
    // Map from API Tier ID to our 0-8 index
    // API Tiers seems to be 0 (Jackpot) to 8 (Match 0+1).
    const winners = Array(9).fill(null).map((_, i) => ({
        prize: i === 0 ? 'Jackpot' : '$0',
        winners: 0,
        multiplierWinners: 0,
        tier: i
    }));

    // Lookup Prize Amount from Matrix
    const matrixTiers = jsonData.PrizeMatrix ? jsonData.PrizeMatrix.PrizeTiers : [];

    if (jsonData.PrizeTiers && Array.isArray(jsonData.PrizeTiers)) {
        jsonData.PrizeTiers.forEach(item => {
            const t = item.Tier;
            if (t >= 0 && t < 9) {
                // Determine if this is a "Base" win or "Megaplier" win
                // Based on user sample, Multiplier is "" for base, "3x" etc for Megaplier.
                // Also `IsMegaplier` might be false even for Multiplier entries in some feeds, so checking Multiplier string is safer.
                const isMegaplier = item.IsMegaplier || (item.Multiplier && item.Multiplier !== "");
                
                if (isMegaplier) {
                    winners[t].multiplierWinners += item.Winners;
                } else {
                    winners[t].winners += item.Winners;
                }
            }
        });
    }

    // Fill in Prize Amounts from Matrix
    matrixTiers.forEach(m => {
        const t = m.PrizeTier;
        if (t > 0 && t < 9) {
            winners[t].prize = formatPrize(m.PrizeAmount);
        }
    });

    // 4. Match Winners (Locations)
    const winnerLocations = [];
    if (jsonData.MatchWinners) {
        let text = jsonData.MatchWinners.RawText || jsonData.MatchWinners.WinnerText || "";
        text = text.replace(/<[^>]*>/g, '').trim();

        // Jackpot
        if (text.includes('Match 5 + 1 Jackpot Winner:')) {
            const m = text.match(/Match 5 \+ 1 Jackpot Winner: ([^M]+)/);
            winnerLocations.push({
                type: 'Match 5 + Mega Ball',
                description: 'Jackpot Winners',
                locations: m ? m[1].trim() : ''
            });
        } else {
             winnerLocations.push({ type: 'Match 5 + Mega Ball', description: 'Jackpot Winners', locations: '' });
        }

        // Match 5 (Million)
        if (text.includes('Match 5 + 0:')) {
             const m = text.match(/Match 5 \+ 0: ([^M]+)/);
             if (m) winnerLocations.push({ type: 'Match 5', description: '$1 Million Winners', locations: m[1].trim() });
        } else if (!winnerLocations.some(l => l.type === 'Match 5')) {
             // If not explicitly found but logic dictates (e.g. empty)
             winnerLocations.push({ type: 'Match 5', description: '$1 Million Winners', locations: '' });
        }

        // Match 5 Megaplier
        if (text.includes('Match 5 + 0 Megaplier:')) {
             const m = text.match(/Match 5 \+ 0 Megaplier: ([^$]+)/);
             if (m) winnerLocations.push({ type: 'Match 5 + Megaplier', description: '$2 Million Winners', locations: m[1].trim() });
        }
    }

    // 5. Video ID
    const videoCode = videoMap ? (videoMap[dateStr] || null) : null;

    return {
        game: "megamillions",
        drawDate: dateStr,
        numbers: winningNumbers,
        megaBall: megaBall,
        megaplier: megaplier,
        jackpot: {
            estimated: jackpotStr === 'TBD' ? 0 : parseCurrency(jackpotStr),
            cash: cashValueStr ? parseCurrency(cashValueStr) : 0,
            strValue: jackpotStr
        },
        prizeTiers: winners,
        winners: winners, // Keeping both for compatibility as per discussion
        winnerLocations: winnerLocations,
        videoCode: videoCode, // Added video ID
        source: "megamillions.com",
        fetchedAt: new Date().toISOString()
    };
}

// Helper to match consistency
function parseCurrency(str) {
    if(!str) return 0;
    const clean = str.replace(/[$,]/g, "").trim();
    if (clean.toLowerCase().includes("million")) {
        return parseFloat(clean) * 1_000_000;
    }
    return parseFloat(clean) || 0;
}


async function run() {
  ensureDir();

  // Fetch Latest
  // Strategy: Use GetDrawingPagingData to find LATEST date, then fetch detailed.
  const pagingUrl = "https://www.megamillions.com/cmspages/utilservice.asmx/GetDrawingPagingData";
  // Page 1, Size 1
  const body = { pageNumber: 1, pageSize: 1, startDate: "1/1/2000", endDate: new Date().toLocaleDateString("en-US") };
  
  try {
      const res = await fetch(pagingUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
          body: JSON.stringify(body)
      });
      const json = await res.json();
      const responseData = json.d ? JSON.parse(json.d) : json;
      const draws = responseData.DrawingData || responseData;
      
      if (draws && draws.length > 0) {
          const rawDate = draws[0].PlayDate;
          let dateStr;

          if (rawDate.includes("/Date(")) {
              const ms = parseInt(rawDate.match(/\d+/)[0]);
              // If it is /Date(...)/ format, it is usually UTC. 
              dateStr = new Date(ms).toISOString().slice(0, 10);
          } else {
             // Assume ISO String YYYY-MM-DDT...
             dateStr = rawDate.split("T")[0];
          }
          
          const explicitTicks = draws[0].PlayDateTicks;

          // Check if file already exists
          const filePath = path.join(DATA_DIR, `${dateStr}.json`);
          if (fs.existsSync(filePath)) {
              console.log(`Skipping ${dateStr} (already exists)`);
              return;
          }

          console.log("Fetching detailed data for:", dateStr);
          const data = await fetchDrawByDate(dateStr, explicitTicks);
          
          if(data) {
              saveDraw(data);
              // Save latest
               fs.writeFileSync(
                path.join(DATA_DIR, "latest.json"),
                JSON.stringify(data, null, 2)
              );
              console.log("✅ Mega Millions saved:", dateStr);
          }
      }
  } catch (err) {
      console.error("❌ Error:", err);
  }
}

if (process.argv[1] === __filename) {
  run();
}
