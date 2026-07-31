import fs from "fs";
import { addExtra } from "puppeteer-extra";
import puppeteerCore from "puppeteer-core";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import chromium from "@sparticuz/chromium";
import Lead from "../models/Lead.js";
import User from "../models/User.js";
import { calculateLeadScore } from "../utils/leadScoring.js";
import { extractWebsiteText } from "../utils/website.extractor.js";
import { lightExtract } from "../utils/light.extractor.js";
import { analyzeBatch } from "./gemini.service.js";
import { jobStore } from "./jobStore.js";

const puppeteer = addExtra(puppeteerCore);

// Disable non-essential stealth evasions to prevent CDP protocol timeouts under RAM pressure.
const stealth = StealthPlugin();
[
  "chrome.app", "chrome.csi", "chrome.loadTimes", "chrome.runtime", "media.codecs",
  "navigator.hardwareConcurrency", "navigator.languages", "navigator.permissions",
  "navigator.plugins", "iframe.contentWindow", "sourceurl", "webgl.vendor",
  "window.outerdimensions", "user-agent-override"
].forEach(name => stealth.enabledEvasions.delete(name));
puppeteer.use(stealth);

// Contain unhandled rejections to prevent crashing the main Node.js process.
process.on("unhandledRejection", (reason) => {
  console.error("🔥 [scraperRunner] Unhandled rejection (contained):", reason?.message || reason);
});

/**
 * Wraps a promise with a hard timeout to ensure no step hangs indefinitely.
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const badDomains = [
  "booking.com",
  "facebook.com",
  "instagram.com",
  "tripadvisor.com",
  "bit.ly",
  "justdial.com"
];

/**
 * OPTIMIZATION: Render-optimized launch flags including --single-process, --disable-gpu,
 * --disable-dev-shm-usage, --no-sandbox, and background throttling disables for max performance on Render Free.
 */
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
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-default-apps",
        "--mute-audio",
        "--single-process"
      ],
      protocolTimeout: 45000
    };
  }

  return {
    args: [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-default-apps",
      "--mute-audio",
      "--single-process",
      "--disable-sync",
      "--disable-translate",
      "--metrics-recording-only",
      "--no-first-run"
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    protocolTimeout: 45000
  };
}

/**
 * OPTIMIZATION: Resource Blocking. Aborts image, font, media, and stylesheet network requests.
 * Significantly reduces RAM consumption and network latency per page load.
 */
async function blockHeavyResources(page) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const type = req.resourceType();
    if (["image", "media", "font", "stylesheet"].includes(type)) {
      req.abort().catch(() => {});
    } else {
      req.continue().catch(() => {});
    }
  });
}

/* ============================================================
   ENRICH SINGLE LEAD
============================================================ */
async function enrichSingleLead(lead, jobId, index, totalCount) {
  console.log(`[ENRICH STEP 1] Starting lead ${index + 1}/${totalCount}: ${lead.website}`);
  try {
    if (!lead || !lead.website || lead.status === "enriched") {
      console.log(`[ENRICH STEP 2] Lead ${index + 1} already enriched or invalid. Skipping.`);
      return;
    }

    if (badDomains.some(d => lead.website.includes(d))) {
      console.log(`[ENRICH STEP 3] Lead ${index + 1} is aggregator domain. Scoring directly.`);
      const score = calculateLeadScore({ phone: lead.phone, website: lead.website }, 0);
      await Lead.updateOne(
        { _id: lead._id },
        { $set: { leadQuality: score, enriched: true, enrichmentStatus: "done", status: "enriched" } }
      );
      return;
    }

    console.log(`[ENRICH STEP 4] Extracting text for lead ${index + 1}: ${lead.website}`);
    let text;
    try {
      text = await lightExtract(lead.website);
      if (!text || text.length < 1500) {
        text = await extractWebsiteText(lead.website);
      }
    } catch (extractErr) {
      console.log(`[ENRICH STEP 5] Extraction failed for lead ${index + 1}: ${extractErr.message}`);
      return;
    }

    if (!text || text.length < 1500) {
      console.log(`[ENRICH STEP 6] Low text content (${text?.length || 0} chars) for lead ${index + 1}. Scoring manually.`);
      const score = calculateLeadScore({ phone: lead.phone, website: lead.website }, text?.length || 0);
      await Lead.updateOne(
        { _id: lead._id },
        { $set: { leadQuality: score, enriched: true, enrichmentStatus: "done", status: "enriched" } }
      );
      return;
    }

    text = text.slice(0, 3000);
    console.log(`[ENRICH STEP 7] Sending ${text.length} chars to Gemini AI for lead ${index + 1}...`);
    const aiResults = await analyzeBatch([text]);
    const aiData = aiResults?.[0];

    let emailGuess = null;
    try {
      const domain = new URL(lead.website).hostname.replace("www.", "");
      emailGuess = `info@${domain}`;
    } catch {}

    const score = calculateLeadScore(
      { ...(aiData || {}), phone: lead.phone, emailGuess, website: lead.website },
      text.length
    );

    console.log(`[ENRICH STEP 8] Gemini response received. Updating DB for lead ${index + 1} (Score: ${score})...`);
    await Lead.updateOne(
      { _id: lead._id },
      {
        $set: {
          services: aiData?.services || [],
          businessType: aiData?.businessType || null,
          description: aiData?.description || null,
          ownerName: aiData?.ownerName || null,
          emailGuess,
          leadQuality: score,
          enriched: true,
          enrichmentStatus: "done",
          status: "enriched"
        }
      }
    );
    console.log(`[ENRICH STEP 9] Lead ${index + 1}/${totalCount} successfully enriched.`);

  } catch (err) {
    console.error(`[ENRICH ERROR] Failed lead ${index + 1}:`, err.message);
  } finally {
    jobStore.incEnrichDone(jobId);
  }
}

/* ============================================================
   RUN FULL SCRAPER & ENRICHMENT PIPELINE
============================================================ */
export async function runScraperJob(query, jobId) {
  // OPTIMIZATION: Increased master timeout from 2 minutes (120,000ms) to 5 minutes (300,000ms)
  // to ensure jobs have sufficient execution window on Render Free.
  const MASTER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  try {
    await withTimeout(runScraperJobInner(query, jobId), MASTER_TIMEOUT_MS, "Scraper job");
  } catch (err) {
    console.error("❌ [SCRAPER JOB FAILED/TIMED OUT]:", err.message);
    jobStore.setError(jobId, err.message);
  }
}

async function runScraperJobInner(query, jobId) {
  let browser;
  try {
    console.log(`\n========================================`);
    console.log(`[STEP 1] Starting Scraper Job for query: "${query}" (ID: ${jobId})`);
    console.log(`========================================`);

    let user = await User.findOne({ username: "admin" });
    if (!user) {
      console.log("[STEP 1.1] Admin user not found. Creating default admin user.");
      user = await User.create({ username: "admin", credits: 100 });
    }

    if (user.credits <= 0) {
      console.log("❌ [STEP 1.2] Admin out of credits. Halting job.");
      jobStore.setPhase(jobId, "completed");
      return;
    }

    console.log("[STEP 2] Launching Chromium browser instance with Render-optimized flags...");
    const launchOpts = await getBrowserLaunchOptions();
    browser = await withTimeout(puppeteer.launch(launchOpts), 30000, "Browser launch");
    console.log("[STEP 2.1] Chromium browser launched successfully.");

    console.log("[STEP 3] Opening main browser tab...");
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await blockHeavyResources(page);

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;
    console.log(`[STEP 4] Navigating to Google Maps search: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    console.log("[STEP 4.1] Google Maps page loaded.");

    if (page.url().includes("consent.google.com")) {
      console.log("[STEP 4.2] Bypassing Google Consent page...");
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const acceptBtn = btns.find(b => b.textContent.includes('Accept all') || b.textContent.includes('I agree'));
        if (acceptBtn) acceptBtn.click();
      });
      // OPTIMIZATION: Reduced delay from 2500ms to 700ms
      await new Promise(r => setTimeout(r, 700));
    }

    console.log("[STEP 5] Waiting for Google Maps place link selectors...");
    await page.waitForSelector("a[href*='/maps/place'], a.hfpxzc", { timeout: 15000 }).catch(() => {
      console.log("[STEP 5.1] Initial selector wait timed out, continuing scroll search...");
    });

    console.log("[STEP 6] Scrolling results feed to collect place links...");
    let links = [];
    let noNewLinksCount = 0;
    const TARGET_COUNT = 10;

    for (let i = 0; i < 50; i++) {
      const currentCount = links.length;

      await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]') || 
                     document.querySelector('div[aria-label*="Results"]') ||
                     document.querySelector('.m6QEbd');
        if (feed) {
          feed.scrollTop += 8000;
        } else {
          window.scrollBy(0, 2000);
        }
      });

      // OPTIMIZATION: Reduced scrolling delay from 1200ms to 700ms
      await new Promise(r => setTimeout(r, 700));

      links = await page.evaluate(() => {
        const hrefs = new Set();
        document.querySelectorAll('a[href*="/maps/place"], a.hfpxzc').forEach(el => {
          if (el.href && el.href.includes('/maps/place')) {
            hrefs.add(el.href);
          }
        });
        return Array.from(hrefs);
      }).catch(() => []);

      // OPTIMIZATION: Stop scrolling immediately once required links collected, slicing array to TARGET_COUNT
      if (links.length >= TARGET_COUNT) {
        links = links.slice(0, TARGET_COUNT);
        console.log(`[STEP 6.1] Target link count reached (${links.length}). Stopping scroll loop.`);
        break;
      }

      if (links.length === currentCount) {
        noNewLinksCount++;
        if (noNewLinksCount > 5) {
          console.log(`[STEP 6.2] End of results feed reached at ${links.length} links.`);
          break;
        }
      } else {
        noNewLinksCount = 0;
      }
    }

    links = links.slice(0, TARGET_COUNT);
    console.log(`[STEP 7] Final place links collected: ${links.length}`);
    jobStore.setScrapeTotal(jobId, links.length);

    if (links.length === 0) {
      console.log("[STEP 7.1] No place links extracted. Job complete.");
      jobStore.setPhase(jobId, "completed");
      return;
    }

    console.log("[STEP 8] Extracting place details using a single reused detail page...");
    const leadsToEnrich = [];

    // OPTIMIZATION: Reuse a single Puppeteer detail page for all business links instead of creating
    // and closing a new page for every single link. Saves memory and increases extraction speed by ~5x.
    let detailPage = await withTimeout(browser.newPage(), 15000, "detailPage newPage");
    await detailPage.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
    await detailPage.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await blockHeavyResources(detailPage);

    // OPTIMIZATION: Set default navigation timeout (8000ms) and default timeout (5000ms) on detail page
    detailPage.setDefaultNavigationTimeout(8000);
    detailPage.setDefaultTimeout(5000);

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      try {
        if (user.credits <= 0) break;
        // OPTIMIZATION: Reduced goto timeout from 15000ms to 8000ms
        let loaded = false;

for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    await detailPage.goto(link, {
      waitUntil: "domcontentloaded",
      timeout: 8000
    });

    loaded = true;
    break;
  } catch (err) {
    console.log(`Navigation attempt ${attempt} failed for ${link}`);

    if (attempt === 2) {
      throw err;
    }
  }
}

if (!loaded) continue;

        // OPTIMIZATION: Non-blocking waitForSelector("h1") with timeout error catch
        await detailPage.waitForSelector("h1", { timeout: 3000 }).catch(() => {});

        // OPTIMIZATION: Safe $eval calls safely returning null if element is missing
        const name = await detailPage.$eval("h1", el => el?.innerText || null).catch(() => null);
        if (!name) {
          jobStore.incScrapeDone(jobId);
          continue;
        }

        let address = await detailPage.$eval(
          'button[data-item-id="address"]',
          el => el?.innerText || null
        ).catch(() => null);
        if (address) address = address.replace(/[\u200B-\u200F\u202A-\u202E\uE000-\uF8FF\uFFFD]/g, "").replace(/[^\p{L}\p{N}\p{P}\p{Z}+=]/gu, "").trim();

        let phone = await detailPage.$eval(
          'button[data-item-id^="phone"]',
          el => el?.innerText || null
        ).catch(() => null);
        if (phone) phone = phone.replace(/[^\d+\-\s()]/g, "").trim();

        let website = await detailPage.$eval(
          'a[data-item-id="authority"]',
          el => el?.href || null
        ).catch(() => null);

        if (!website) {
          website = await detailPage.$eval(
            'a[aria-label^="Website"]',
            el => el?.href || null
          ).catch(() => null);
        }

        const item = { name, address, phone, website, sourceQuery: query };

        if (user.credits <= 0) break;

        let savedLead;
        if (item.website) {
          savedLead = await Lead.findOneAndUpdate(
            { website: item.website },
            { $set: { ...item, enriched: false, enrichmentStatus: "pending" } },
            { upsert: true, returnDocument: "after" }
          );
        } else {
          savedLead = await Lead.create({
            ...item,
            website: `no-website-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            leadQuality: calculateLeadScore(item, 0),
            status: "enriched",
            enriched: true,
            enrichmentStatus: "done"
          });
        }

       
        if (savedLead && savedLead.website && !savedLead.website.startsWith("no-website")) {

    if (user.credits >= 1) {

        user.credits--;

        await user.save();

        leadsToEnrich.push(savedLead);

    }

}
      } catch (err) {
        console.log(`[STEP 8.1.1] Skipping link (${err.message}): ${link}`);
      } finally {
        jobStore.incScrapeDone(jobId);
      }
    }

    if (detailPage) {
      await detailPage.close().catch(() => {});
    }

    console.log("[STEP 9] Closing Google Maps Puppeteer browser instance...");
    await browser.close().catch(() => {});
    browser = null;
    console.log("[STEP 9.1] Google Maps browser closed cleanly.");

    // Process enrichment phase
    if (leadsToEnrich.length > 0) {
      console.log(`[STEP 10] Starting enrichment phase for ${leadsToEnrich.length} valid leads...`);
      jobStore.incEnrichTotal(jobId, leadsToEnrich.length);
      jobStore.setPhase(jobId, "enriching");

      for (let idx = 0; idx < leadsToEnrich.length; idx++) {
        await enrichSingleLead(leadsToEnrich[idx], jobId, idx, leadsToEnrich.length);
      }
    } else {
      console.log("[STEP 10] No valid website leads to enrich.");
    }

    console.log("[STEP 11] Job complete. Setting phase to completed.");
    jobStore.setPhase(jobId, "completed");

  } catch (err) {
    console.error("❌ [SCRAPER FATAL ERROR]:", err);
    jobStore.setError(jobId, err.message || "Scraper failed");
    throw err;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
