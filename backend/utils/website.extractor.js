import axios from "axios";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";

const BLOCKED = [
  "instagram.com",
  "linkedin.com",
  "facebook.com",
  "booking.com",
  "makemytrip.com",
  "tripadvisor.com",
  "marriott.com",
  "hyatt.com",
  "tajhotels.com",
  "radissonhotels.com"
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
      timeout: 10000
    });

    const text = await page.evaluate(() => {
      document.querySelectorAll("script,style,noscript").forEach(el => el.remove());
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
    text = await puppeteerExtract(url);
  }

  if (!text || text.length < 300) return null;

  return text;
};