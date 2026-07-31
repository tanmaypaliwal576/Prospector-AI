import fs from "fs";
import axios from "axios";
import * as cheerio from "cheerio";
import puppeteerCore from "puppeteer-core";
import chromium from "@sparticuz/chromium";

async function getBrowserLaunchOptions() {
  if (process.platform === "win32") {
    const winPaths = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
    ];
    const foundPath = winPaths.find(p => fs.existsSync(p));
    return {
      headless: true,
      executablePath: foundPath || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    };
  }

  return {
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless
  };
}

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
    const launchOpts = await getBrowserLaunchOptions();
    browser = await puppeteerCore.launch(launchOpts);

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