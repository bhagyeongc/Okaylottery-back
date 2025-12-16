import * as cheerio from "cheerio";

console.log("Keys on cheerio namespace:", Object.keys(cheerio));

if (cheerio.default) {
    console.log("Has default export.");
    console.log("Keys on cheerio.default:", Object.keys(cheerio.default));
}

if (cheerio.load) {
    console.log("cheerio.load exists on namespace.");
}

console.log("Done.");
