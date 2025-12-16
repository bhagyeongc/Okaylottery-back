import { fetchDraw, updateIndex, ensureDir, DATA_DIR } from "./powerball.js";
import fs from "fs";
import path from "path";

const START_DATE = "2023-01-01";
// End date is yesterday to avoid conflict with 'latest' run or today's incomplete draw
const YESTERDAY = new Date();
YESTERDAY.setDate(YESTERDAY.getDate() - 1);
const END_DATE = YESTERDAY.toISOString().slice(0, 10);

function addDays(dateStr, days) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function getDayOfWeek(dateStr) {
  // 0=Sun, 1=Mon, ..., 6=Sat
  // Powerball: Mon(1), Wed(3), Sat(6)
  return new Date(dateStr).getDay();
}

async function run() {
  ensureDir();

  let current = START_DATE;
  console.log(`Starting historical fetch from ${START_DATE} to ${END_DATE}`);

  while (current <= END_DATE) {
    const day = getDayOfWeek(current);
    
    // Draw days: Mon, Wed, Sat
    if (day === 1 || day === 3 || day === 6) {
      const filePath = path.join(DATA_DIR, `${current}.json`);

      if (fs.existsSync(filePath)) {
        console.log(`Skipping ${current} (already exists)`);
         // We still want to ensure it's in the index, just in case
         updateIndex(current);
      } else {
        console.log(`Fetching ${current}...`);
        try {
          const data = await fetchDraw(current);
          if (data) {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            updateIndex(current);
            console.log(`✅ Saved ${current}`);
            
            // Rate limit: 500ms
            await new Promise((resolve) => setTimeout(resolve, 500));
          } else {
            console.log(`⚠️ No data found for ${current} (might be holiday or error)`);
          }
        } catch (err) {
          console.error(`❌ Error fetching ${current}:`, err.message);
        }
      }
    }
    current = addDays(current, 1);
  }
  
  console.log("Historical data collection complete.");
}

run();
