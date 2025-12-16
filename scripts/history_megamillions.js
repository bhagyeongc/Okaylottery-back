import { saveDraw, ensureDir, fetchDrawByDate, DATA_DIR } from "./megamillions.js";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const API_URL = "https://www.megamillions.com/cmspages/utilservice.asmx/GetDrawingPagingData";

async function run() {
    ensureDir();
    console.log("Starting Mega Millions history fetch...");

    let page = 1;
    let totalDraws = 0;
    const pageSize = 50;

    // Safety: Collect IDs first, then process sequentially
    while (true) {
        console.log(`Scanning page ${page}...`);
        
        const body = {
            pageNumber: page,
            pageSize: pageSize,
            startDate: "1/1/2023",
            endDate: new Date().toLocaleDateString("en-US")
        };

        try {
            const res = await fetch(API_URL, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                console.error(`Failed to fetch page ${page}`);
                break;
            }

            const json = await res.json();
            const responseData = json.d ? JSON.parse(json.d) : json;
            const draws = responseData.DrawingData || responseData;

            if (!Array.isArray(draws) || draws.length === 0) {
                console.log("No more data found.");
                break;
            }

            for (const draw of draws) {
                const rawDate = draw.PlayDate;
                if (!rawDate) continue;
                
                let drawDate;
                if (rawDate.includes("/Date(")) {
                    const ms = parseInt(rawDate.match(/\d+/)[0]);
                    // If it is a timestamp, we trust it is UTC midnight for the draw date.
                    // But to be safe against shift, we can use UTC methods or just ISO.
                    // Usually /Date/ is reliable UTC.
                    drawDate = new Date(ms).toISOString().slice(0, 10);
                } else {
                    // Start is YYYY-MM-DD... just take it.
                    // This avoids "new Date()" treating it as Local and shifting to UTC previous day.
                    drawDate = rawDate.split("T")[0];
                }
                
                console.log(`Checking ${drawDate}...`);
                
                // Check if file already exists
                const filePath = path.join(DATA_DIR, `${drawDate}.json`);
                if (fs.existsSync(filePath)) {
                    console.log(`Skipping ${drawDate} (already exists)`);
                    continue;
                }
                
                console.log(`Fetching details for ${drawDate}...`);
                
                try {
                    const ticks = draw.PlayDateTicks; // Use explicit ticks from API
                    const detailedData = await fetchDrawByDate(drawDate, ticks);
                    if (detailedData) {
                        saveDraw(detailedData);
                        totalDraws++;
                        // Rate limit slightly
                        await new Promise(r => setTimeout(r, 200));
                    }
                } catch (e) {
                    console.error(`Failed detailed fetch for ${drawDate}:`, e.message);
                }
            }
            
            page++;
            if (page > 50) break;

        } catch (err) {
            console.error(`Error processing page ${page}:`, err);
            break;
        }
    }
    
    console.log(`History collection complete. Total draws: ${totalDraws}`);
}

run();
