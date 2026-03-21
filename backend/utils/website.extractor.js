import axios from "axios";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";

const BLOCKED = [
  "instagram.com",
  "linkedin.com",
  "facebook.com",
  "makemytrip.com",
  "booking.com",
  "tripadvisor.com"
];

function shouldSkip(url) {
  return BLOCKED.some(d => url.includes(d));
}

function clean(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 8000);
}

async function axiosExtract(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 12000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    $("script, style, noscript").remove();

    return clean($("body").text());
  } catch {
    return null;
  }
}

async function puppeteerExtract(url) {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"]
    });

    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 25000
    });

    await new Promise(r => setTimeout(r, 3000));

    const text = await page.evaluate(() => {
      document.querySelectorAll("script,style,noscript")
        .forEach(el => el.remove());
      return document.body.innerText;
    });

    return clean(text);

  } catch {
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

export const extractWebsiteText = async (url) => {
  if (!url || shouldSkip(url)) return null;

  let text = await axiosExtract(url);

  if (!text || text.length < 300) {
    console.log("Fallback to Puppeteer:", url);
    text = await puppeteerExtract(url);
  }

  if (!text || text.length < 300) {
    console.log("No usable content:", url);
    return null;
  }

  return text;
};