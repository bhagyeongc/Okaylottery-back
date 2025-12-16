import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerioModule from "cheerio";
const cheerio = cheerioModule.default || cheerioModule;
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATA_DIR = path.join(__dirname, "../data/powerball");

export function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Parsing Constants
const TIER_RULES = [
  { tier: 0, matchWhite: 5, matchSpecial: true, isJackpot: true, odds: 292201338 },
  { tier: 1, matchWhite: 5, matchSpecial: false, isJackpot: false, odds: 11688054 },
  { tier: 2, matchWhite: 4, matchSpecial: true, isJackpot: false, odds: 913129 },
  { tier: 3, matchWhite: 4, matchSpecial: false, isJackpot: false, odds: 36525 },
  { tier: 4, matchWhite: 3, matchSpecial: true, isJackpot: false, odds: 14494 },
  { tier: 5, matchWhite: 3, matchSpecial: false, isJackpot: false, odds: 579 },
  { tier: 6, matchWhite: 2, matchSpecial: true, isJackpot: false, odds: 701 },
  { tier: 7, matchWhite: 1, matchSpecial: true, isJackpot: false, odds: 92 },
  { tier: 8, matchWhite: 0, matchSpecial: true, isJackpot: false, odds: 38 },
];

function parseCurrency(str) {
  if (!str) return 0;
  if (str.includes("Grand Prize") || str.includes("Jackpot")) return "JACKPOT";
  
  const clean = str.replace(/[$,]/g, "").trim();
  if (clean.toLowerCase().includes("billion")) {
    return parseFloat(clean) * 1_000_000_000;
  }
  if (clean.toLowerCase().includes("million")) {
    return parseFloat(clean) * 1_000_000;
  }
  return parseFloat(clean) || 0;
}

function parseInteger(str) {
  if (!str) return 0;
  return parseInt(str.replace(/[,]/g, "").trim(), 10) || 0;
}

export async function fetchDraw(date) {
  // Use user-provided URL structure and User-Agent
  const url = `https://www.powerball.com/draw-result?gc=powerball&date=${date}`;
  const html = await (await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
    }
  })).text();
  
  const $ = cheerio.load(html);

  // 1. Numbers
  const numbers = [];
  // Selector based on user HTML: <div class="form-control col white-balls item-powerball">
  $(".white-balls.item-powerball").each((_, el) => {
      const txt = $(el).text().trim();
      if(txt) numbers.push(Number(txt));
  });

  // Powerball (Red Ball)
  // Selector: <div class="form-control col powerball item-powerball">
  const powerBallText = $(".powerball.item-powerball").text().trim();
  const powerBall = powerBallText ? Number(powerBallText) : null;

  // If no numbers found, it might be an invalid date or future date
  if (numbers.length === 0 || !powerBall) {
    return null;
  }

  // 2. Power Play
  const powerPlayText = $(".power-play .multiplier").text().trim(); // e.g. "2x"
  const powerPlay = powerPlayText ? parseInt(powerPlayText.replace("x", ""), 10) : 1; // Default 1 if missing? Or null? Usually 2x, 3x etc.

  // 3. Jackpot
  const estJackpotStr = $(".estimated-jackpot").find("span").last().text(); // Value is usually in second span or just text
  const cashValueStr = $(".cash-value").find("span").last().text();
  
  // Jackpot winners count is in the first row of table (Tier 0), column 'Powerball Winners'
  // But let's check the logic. table rows map to TIER_RULES order.
  // We'll extract this during Prize Tiers iteration.
  let jackpotWinners = 0;

  // 4. Prize Tiers
  const prizeTiers = [];
  
  // Select table rows. The table has class 'winners-table'
  // Rows in tbody. 
  // Order in standard Powerball site is usually Top Prize down to Lowest.
  // We assume standard order 0 to 8 as per TIER_RULES constant.
  const rows = $(".winners-table tbody tr");
  
  rows.each((i, row) => {
      if (i >= TIER_RULES.length) return; // Safety

      const cols = $(row).find("td");
      // Format: Match (visual), PB Winners, PB Prize, PP Winners, PP Prize
      // Indices: 0=Match, 1=Base Winners, 2=Base Prize, 3=PP Winners, 4=PP Prize
      
      const baseWinnersStr = $(cols[1]).text().trim();
      const basePrizeStr = $(cols[2]).text().trim();
      const ppWinnersStr = $(cols[3]).text().trim();
      const ppPrizeStr = $(cols[4]).text().trim();

      const baseWinners = parseInteger(baseWinnersStr);
      const ppWinners = parseInteger(ppWinnersStr);
      
      const basePrize = parseCurrency(basePrizeStr);
      const ppPrize = parseCurrency(ppPrizeStr);

      if (i === 0) {
          jackpotWinners = baseWinners;
      }

      const rule = TIER_RULES[i];
      
      prizeTiers.push({
          tier: rule.tier,
          matchWhite: rule.matchWhite,
          matchSpecial: rule.matchSpecial,
          isJackpot: rule.isJackpot,
          winners: {
              base: baseWinners,
              multiplier: ppWinners
          },
          prize: {
              base: basePrize,
              multiplier: ppPrize
          },
          odds: rule.odds
      });
  });

  const jackpot = {
      estimated: parseCurrency(estJackpotStr),
      cash: parseCurrency(cashValueStr),
      winners: jackpotWinners
  };

  // 5. Video ID
  // Iframe src example: https://www.youtube.com/embed/7nCs0VMoPK0?hl=en
  const videoSrc = $(".video-card iframe").attr("src");
  let videoCode = null;
  if (videoSrc) {
    const match = videoSrc.match(/\/embed\/([^/?]+)/);
    if (match && match[1]) {
        videoCode = match[1];
    }
  }

  // 6. Winners Information
  const winners = [];
  $(".winner-card .winners-group").each((_, el) => {
      const title = $(el).find(".game-name").text().trim();
      const description = $(el).find(".winner-type").text().trim();
      const locationText = $(el).find(".winner-location").text().trim();
      
      winners.push({
          title, // e.g. "Match 5 + Power Play"
          description, // e.g. "$2 Million Winners"
          locations: locationText // e.g. "NC, PA"
      });
  });

  return {
    game: "powerball",
    drawDate: date, // Keep string format YYYY-MM-DD
    numbers,
    powerBall,
    powerPlay, // Added
    jackpot,
    prizeTiers,
    winners, // Added winners locations
    videoCode, // Added video ID
    source: "powerball.com",
    fetchedAt: new Date().toISOString(),
  };
}

export function updateIndex(drawDate) {
  const indexPath = path.join(DATA_DIR, "index.json");
  let index = { game: "powerball", draws: [] };

  if (fs.existsSync(indexPath)) {
    index = JSON.parse(fs.readFileSync(indexPath));
  }

  if (!index.draws.includes(drawDate)) {
    index.draws.push(drawDate);
    // Sort descending
    index.draws.sort((a, b) => b.localeCompare(a));
  }

  index.total = index.draws.length;
  index.updatedAt = new Date().toISOString();

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

async function run() {
  ensureDir();

  // Basic logic: Fetch today's if running directly
  // Note: Powerball draws are Mon, Wed, Sat.
  // This simple check just tries to fetch "today" which might fail if today isn't a draw day
  // or if results aren't up.
  // For robustness, usually we might check the last few days if we strictly want "latest".
  // But strictly following original logic which used "today":
  const today = new Date().toISOString().slice(0, 10);
  
  if (fs.existsSync(path.join(DATA_DIR, `${today}.json`))) {
    console.log(`Skipping ${today} (already exists)`);
    return;
  }
  
  try {
    const data = await fetchDraw(today);
    
    if (data) {
        fs.writeFileSync(
            path.join(DATA_DIR, `${today}.json`),
            JSON.stringify(data, null, 2)
        );

        fs.writeFileSync(
            path.join(DATA_DIR, "latest.json"),
            JSON.stringify(data, null, 2)
        );

        updateIndex(today);
        console.log("✅ Powerball saved:", today);
    } else {
        console.log("⚠️ No data found for:", today);
    }
  } catch (err) {
    console.error("❌ Error fetching Powerball:", err);
    process.exit(1);
  }
}

// Check if direct execution
if (process.argv[1] === __filename) {
  run();
}
