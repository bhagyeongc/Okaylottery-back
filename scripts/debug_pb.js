import fs from "fs";

async function debug() {
    const date = "2025-12-13"; 
    console.log(`Fetching Powerball for ${date}...`);
    
    try {
        const data = await fetchDraw(date);
        fs.writeFileSync("debug_result.json", JSON.stringify(data, null, 2));
        console.log("Saved to debug_result.json");
    } catch (e) {
        console.error("Error:", e);
        fs.writeFileSync("debug_error.txt", String(e));
    }
}

debug();
