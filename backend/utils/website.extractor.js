import axios from "axios";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";

const BLOCKED_DOMAINS = [
  "instagram.com",
  "linkedin.com",
  "facebook.com",
  "apollo247.com",
  "healthplix.com"
];

function shouldSkip(url) {
  return BLOCKED_DOMAINS.some(domain => url.includes(domain));
}

function cleanText(text) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 5000); // slightly larger context for AI
}

/* ---------------- AXIOS FAST EXTRACTION ---------------- */

async function extractAxios(url) {

  try {

    const { data } = await axios.get(url, {
      timeout: 12000,
      maxRedirects: 5,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept-Encoding": "gzip,deflate,br"
      }
    });

    const $ = cheerio.load(data);

    $("script,style,noscript,header,footer,svg").remove();

    const text = $("p,h1,h2,h3,h4,li")
      .map((i, el) => $(el).text())
      .get()
      .join(" ");

    return cleanText(text);

  } catch {

    return null;

  }

}

/* ---------------- PUPPETEER FALLBACK ---------------- */

async function extractPuppeteer(url) {

  let browser;

  try {

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    );

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 30000
    });

    /* wait for page JS */

    await new Promise(r => setTimeout(r, 3000));

    const text = await page.evaluate(() => {

      document
        .querySelectorAll("script,style,noscript,header,footer,svg")
        .forEach(el => el.remove());

      const elements = document.querySelectorAll(
        "p,h1,h2,h3,h4,li"
      );

      return Array.from(elements)
        .map(el => el.innerText)
        .join(" ");

    });

    return cleanText(text);

  } catch {

    return null;

  } finally {

    if (browser) await browser.close();

  }

}

/* ---------------- MAIN EXTRACTOR ---------------- */

export const extractWebsiteText = async (url) => {

  if (!url || shouldSkip(url)) return null;

  /* try axios first (fast) */

  let text = await extractAxios(url);

  if (!text || text.length < 200) {

    console.log("Fallback to Puppeteer:", url);

    text = await extractPuppeteer(url);

  }

  if (!text || text.length < 200) {
    console.log("No usable content:", url);
    return null;
  }

  return text;

};