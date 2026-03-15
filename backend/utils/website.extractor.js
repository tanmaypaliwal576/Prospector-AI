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
    .slice(0, 4000);
}

async function extractAxios(url) {

  try {

    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
      }
    });

    const $ = cheerio.load(data);

    $("script,style,noscript").remove();

    const text = $("body").text();

    return cleanText(text);

  } catch {

    return null;

  }

}

async function extractPuppeteer(url) {

  let browser;

  try {

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"]
    });

    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 20000
    });

    const text = await page.evaluate(() => {

      document
        .querySelectorAll("script,style,noscript")
        .forEach(el => el.remove());

      return document.body.innerText;

    });

    return cleanText(text);

  } catch {

    return null;

  } finally {

    if (browser) await browser.close();

  }

}

export const extractWebsiteText = async (url) => {

  if (!url || shouldSkip(url)) return null;

  let text = await extractAxios(url);

  if (!text || text.length < 200) {

    console.log("Fallback to Puppeteer:", url);

    text = await extractPuppeteer(url);

  }

  return text;

};