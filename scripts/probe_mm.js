import fetch from "node-fetch";

const API_URL = "https://www.megamillions.com/cmspages/utilservice.asmx/GetDrawingPagingData";

async function probe() {
    try {
        const body = {
            pageNumber: 1,
            pageSize: 1,
            startDate: "1/1/2023",
            endDate: "12/31/2023"
        };
        
        console.log("Sending POST to", API_URL);
        const res = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        
        const txt = await res.text();
        console.log("Response text:", txt);
        
        try {
            const json = JSON.parse(txt);
            console.log("Parsed JSON:", JSON.stringify(json, null, 2));
            
            if (json.d) {
                const inner = JSON.parse(json.d);
                console.log("Inner JSON:", JSON.stringify(inner, null, 2));
            }
        } catch (e) {
            console.log("Not strict JSON or error parsing.");
        }
        
    } catch (err) {
        console.error("Error:", err);
    }
}

probe();
