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

const stealth = StealthPlugin();
[
  "chrome.app", "chrome.csi", "chrome.loadTimes", "chrome.runtime", "media.codecs",
  "navigator.hardwareConcurrency", "navigator.languages", "navigator.permissions",
  "navigator.plugins", "iframe.contentWindow", "sourceurl", "webgl.vendor",
  "window.outerdimensions", "user-agent-override"
].forEach(name => stealth.enabledEvasions.delete(name));
puppeteer.use(stealth);

process.on("unhandledRejection", (reason) => {
  console.error("🔥 [scraperRunner] Unhandled rejection (contained):", reason?.message || reason);
});

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

async function blockHeavyResources(page) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const type = req.resourceType();
    if (["image", "media", "font", "stylesheet", "ping", "prefetch", "manifest"].includes(type)) {
      req.abort().catch(() => {});
    } else {
      req.continue().catch(() => {});
    }
  });
}

async function safeClosePage(page) {
  if (!page) return;
  try {
    page.removeAllListeners("request");
    await page.close().catch(() => {});
  } catch (e) {}
}

async function createWorkerPage(browser) {
  const p = await withTimeout(browser.newPage(), 15000, "Worker newPage");
  await p.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
  await p.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  await blockHeavyResources(p);
  p.setDefaultNavigationTimeout(25000);
  p.setDefaultTimeout(10000);
  return p;
}

/* ============================================================
   ENRICH SINGLE LEAD
============================================================ */
async function enrichSingleLead(lead, jobId, index, totalCount) {
  console.log(`[ENRICH STEP 1] Starting lead ${index + 1}/${totalCount}: ${lead.website}`);
  const startTime = Date.now();
  try {
    if (!lead || !lead.website || lead.status === "enriched") {
      console.log(`[ENRICH STEP 2] Lead ${index + 1} already enriched or invalid. Skipping.`);
      return 0;
    }

    if (badDomains.some(d => lead.website.includes(d))) {
      console.log(`[ENRICH STEP 3] Lead ${index + 1} is aggregator domain. Scoring directly.`);
      const score = calculateLeadScore({ phone: lead.phone, website: lead.website }, 0);
      await Lead.updateOne(
        { _id: lead._id },
        { $set: { leadQuality: score, enriched: true, enrichmentStatus: "done", status: "enriched" } }
      );
      return Date.now() - startTime;
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
      return Date.now() - startTime;
    }

    if (!text || text.length < 1500) {
      console.log(`[ENRICH STEP 6] Low text content (${text?.length || 0} chars) for lead ${index + 1}. Scoring manually.`);
      const score = calculateLeadScore({ phone: lead.phone, website: lead.website }, text?.length || 0);
      await Lead.updateOne(
        { _id: lead._id },
        { $set: { leadQuality: score, enriched: true, enrichmentStatus: "done", status: "enriched" } }
      );
      return Date.now() - startTime;
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
    return Date.now() - startTime;

  } catch (err) {
    console.error(`[ENRICH ERROR] Failed lead ${index + 1}:`, err.message);
    return Date.now() - startTime;
  } finally {
    jobStore.incEnrichDone(jobId);
  }
}

/* ============================================================
   BACKGROUND ENRICHMENT (NON-BLOCKING FOR SCRAPER JOB)
============================================================ */
async function startBackgroundEnrichment(leadsToEnrich, jobId) {
  if (!leadsToEnrich || leadsToEnrich.length === 0) {
    console.log("Enrichment Finished (0 leads to enrich)");
    jobStore.setPhase(jobId, "completed");
    return;
  }

  console.log("Enrichment Started");
  const ENRICH_CONCURRENCY = 3;
  const enrichStart = Date.now();
  const enrichDurations = [];
  let enrichQueueIndex = 0;

  async function enrichWorker(workerId) {
    while (enrichQueueIndex < leadsToEnrich.length) {
      const idx = enrichQueueIndex++;
      if (idx >= leadsToEnrich.length) break;

      const lead = leadsToEnrich[idx];
      console.log(`[ENRICH WORKER #${workerId}] Enriching lead ${idx + 1}/${leadsToEnrich.length}: ${lead.website}`);
      const dur = await enrichSingleLead(lead, jobId, idx, leadsToEnrich.length);
      if (dur > 0) enrichDurations.push(dur);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ENRICH_CONCURRENCY, leadsToEnrich.length) }, (_, i) => enrichWorker(i + 1))
  );

  const avgGeminiTime = enrichDurations.length ? Math.round(enrichDurations.reduce((a, b) => a + b, 0) / enrichDurations.length) : 0;
  console.log(`Average Gemini Time: ${avgGeminiTime} ms`);
  console.log("Enrichment Finished");
  jobStore.setPhase(jobId, "completed");
}

/* ============================================================
   RUN FULL SCRAPER & ENRICHMENT PIPELINE
============================================================ */
export async function runScraperJob(query, jobId) {
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
  const scrapeStartTime = Date.now();

  try {
    console.log("Scrape Started");
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
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
    console.log("[STEP 4.1] Google Maps page loaded.");

    if (page.url().includes("consent.google.com")) {
      console.log("[STEP 4.2] Bypassing Google Consent page...");
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const acceptBtn = btns.find(b => b.textContent.includes('Accept all') || b.textContent.includes('I agree'));
        if (acceptBtn) acceptBtn.click();
      });
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

    await safeClosePage(page);

    // ============================================================
    // 1 & 2. WORKER POOL (4 WORKERS) WITH INDEX-BASED QUEUE
    // ============================================================
    const WORKER_COUNT = 4;
    console.log(`[STEP 8] Initializing Worker Pool of ${WORKER_COUNT} reusable detail pages...`);

    let queueIndex = 0;
    let availableCredits = user.credits;
    const extractedResults = [];
    const pageLoadTimes = [];
    const extractionTimes = [];
    const workerIdleTimes = [];

    const workers = await Promise.all(
      Array.from({ length: WORKER_COUNT }, async (_, id) => {
        const workerPage = await createWorkerPage(browser);
        return {
          id: id + 1,
          page: workerPage,
          itemsProcessed: 0,
          busyTime: 0,
          idleStart: Date.now()
        };
      })
    );

    async function runWorker(worker) {
      while (true) {
        if (availableCredits <= 0) break;

        // O(1) Index-based queue pointer instead of array.shift()
        let currentIndex;
        if (queueIndex >= links.length) break;
        currentIndex = queueIndex++;

        const link = links[currentIndex];
        if (!link) break;

        const idleDuration = Date.now() - worker.idleStart;
        workerIdleTimes.push(idleDuration);

        // Periodic Page Refresh every 15 items
        if (worker.itemsProcessed >= 15) {
          console.log(`[WORKER #${worker.id}] Refreshing worker page after 15 items...`);
          await safeClosePage(worker.page);
          worker.page = await createWorkerPage(browser);
          worker.itemsProcessed = 0;
        }

        console.log(`[WORKER #${worker.id}] Processing link ${currentIndex + 1}/${links.length}`);
        const navStart = Date.now();

        try {
          let navSuccess = false;

          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              await worker.page.goto(link, { waitUntil: "domcontentloaded", timeout: 25000 });
              navSuccess = true;
              break;
            } catch (navErr) {
              if (attempt === 2) {
                console.log(`[WORKER #${worker.id}] Navigation failed after retry for link ${currentIndex + 1}: ${navErr.message}`);
                // Error Recovery: Restart crashed worker page automatically
                console.log(`Worker Restarted (Worker #${worker.id})`);
                await safeClosePage(worker.page);
                worker.page = await createWorkerPage(browser);
                worker.itemsProcessed = 0;
              }
            }
          }

          const navDuration = Date.now() - navStart;
          pageLoadTimes.push(navDuration);
          console.log(`[WORKER #${worker.id}] Page loaded in ${navDuration} ms for link ${currentIndex + 1}`);

          if (!navSuccess) {
            jobStore.incScrapeDone(jobId);
            worker.idleStart = Date.now();
            continue;
          }

          const extractStart = Date.now();

          // Single page.evaluate() call for fast DOM extraction
          const data = await worker.page.evaluate(() => {
            const h1 = document.querySelector('h1');
            if (!h1 || !h1.innerText.trim()) return null;
            const name = h1.innerText.trim();

            const addrBtn = document.querySelector('button[data-item-id="address"]');
            let address = addrBtn ? addrBtn.innerText.trim() : null;
            if (address) {
              address = address.replace(/[\u200B-\u200F\u202A-\u202E\uE000-\uF8FF\uFFFD]/g, "").replace(/[^\p{L}\p{N}\p{P}\p{Z}+=]/gu, "").trim();
            }

            const phoneBtn = document.querySelector('button[data-item-id^="phone"]');
            let phone = phoneBtn ? phoneBtn.innerText.trim() : null;
            if (phone) {
              phone = phone.replace(/[^\d+\-\s()]/g, "").trim();
            }

            const webLink = document.querySelector('a[data-item-id="authority"]') || document.querySelector('a[aria-label^="Website"]');
            let website = webLink ? webLink.href : null;

            return { name, address, phone, website };
          }).catch(() => null);

          const extractDuration = Date.now() - extractStart;
          extractionTimes.push(extractDuration);
          console.log(`[WORKER #${worker.id}] Extraction completed in ${extractDuration} ms for link ${currentIndex + 1}`);

          if (data && data.name) {
            extractedResults.push({ ...data, sourceQuery: query });
            if (data.website) {
              availableCredits--;
            }
          }

          worker.itemsProcessed++;
          worker.busyTime += (navDuration + extractDuration);

        } catch (err) {
          console.log(`[WORKER #${worker.id}] Error processing link ${currentIndex + 1}: ${err.message}`);
          console.log(`Worker Restarted (Worker #${worker.id})`);
          await safeClosePage(worker.page);
          worker.page = await createWorkerPage(browser);
          worker.itemsProcessed = 0;
        } finally {
          jobStore.incScrapeDone(jobId);
          worker.idleStart = Date.now();
        }
      }
      console.log(`[WORKER #${worker.id}] Finished all assigned work.`);
    }

    await Promise.all(workers.map(w => runWorker(w)));

    // Safely close all worker pages
    await Promise.all(workers.map(w => safeClosePage(w.page)));

    // ============================================================
    // 3, 4 & 7. BULK WRITE ({ ordered: false }) & SINGLE USER CREDIT DEDUCTION
    // ============================================================
    const dbWriteStart = Date.now();
    const leadsToEnrich = [];
    let dbWriteDuration = 0;

    if (extractedResults.length > 0) {
      console.log(`[STEP 8.2] Preparing bulkWrite for ${extractedResults.length} extracted leads...`);
      const bulkOps = extractedResults.map((item) => {
        if (item.website) {
          return {
            updateOne: {
              filter: { website: item.website },
              update: { $set: { ...item, enriched: false, enrichmentStatus: "pending" } },
              upsert: true
            }
          };
        } else {
          return {
            insertOne: {
              document: {
                ...item,
                website: `no-website-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                leadQuality: calculateLeadScore(item, 0),
                status: "enriched",
                enriched: true,
                enrichmentStatus: "done"
              }
            }
          };
        }
      });

      const bulkResult = await Lead.bulkWrite(bulkOps, { ordered: false });
      dbWriteDuration = Date.now() - dbWriteStart;
      console.log(`[STEP 8.3] Lead.bulkWrite completed in ${dbWriteDuration} ms (Inserted: ${bulkResult.insertedCount || 0}, Upserted: ${bulkResult.upsertedCount || 0}, Modified: ${bulkResult.modifiedCount || 0}).`);

      // Avoid extra MongoDB Lead.find() by directly filtering extracted results with websites
      const validResults = extractedResults.filter(r => r.website);
      if (validResults.length > 0) {
        const deductAmount = validResults.length;
        if (user.credits >= deductAmount) {
          user.credits -= deductAmount;
          await user.save(); // SAVE USER CREDITS ONCE
          console.log(`[STEP 8.4] Single credit deduction completed (${deductAmount} credits deducted). Remaining: ${user.credits}`);
        }

        // Fetch created/upserted leads for enrichment
        const validWebsites = validResults.map(r => r.website);
        const savedLeads = await Lead.find({ website: { $in: validWebsites } }).lean();
        leadsToEnrich.push(...savedLeads);
      }
    }

    console.log("[STEP 9] Closing Google Maps Puppeteer browser instance...");
    await browser.close().catch(() => {});
    browser = null;
    console.log("[STEP 9.1] Google Maps browser closed cleanly.");

    const totalScrapeDuration = Date.now() - scrapeStartTime;
    const avgNavigation = pageLoadTimes.length ? Math.round(pageLoadTimes.reduce((a, b) => a + b, 0) / pageLoadTimes.length) : 0;
    const avgExtraction = extractionTimes.length ? Math.round(extractionTimes.reduce((a, b) => a + b, 0) / extractionTimes.length) : 0;
    const totalIdleTime = workerIdleTimes.length ? Math.round(workerIdleTimes.reduce((a, b) => a + b, 0)) : 0;
    const totalBusyTime = workers.reduce((acc, w) => acc + w.busyTime, 0);
    const workerBusyPercent = (totalBusyTime + totalIdleTime) > 0 ? ((totalBusyTime / (totalBusyTime + totalIdleTime)) * 100).toFixed(1) : "100.0";
    const workerIdlePercent = (100 - parseFloat(workerBusyPercent)).toFixed(1);
    const peakMemoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    console.log("Scrape Finished");
    console.log(`\n========================================`);
    console.log(`📊 SCRAPE PERFORMANCE METRICS:`);
    console.log(`- Total Runtime: ${totalScrapeDuration} ms`);
    console.log(`- Average Navigation: ${avgNavigation} ms`);
    console.log(`- Average Extraction: ${avgExtraction} ms`);
    console.log(`- Average Mongo Time: ${dbWriteDuration} ms`);
    console.log(`- Total Worker Idle Time: ${totalIdleTime} ms`);
    console.log(`- Worker Busy %: ${workerBusyPercent} %`);
    console.log(`- Worker Idle %: ${workerIdlePercent} %`);
    console.log(`- Peak Memory Usage: ${peakMemoryUsage} MB`);
    console.log(`========================================\n`);

    // ============================================================
    // 1. TRUE BACKGROUND ENRICHMENT (IMMEDIATE FRONTEND UNBLOCK)
    // ============================================================
    console.log("[STEP 9.2] Scraping complete. Returning control immediately to frontend.");
    jobStore.setPhase(jobId, "enriching");

    // Launch background enrichment WITHOUT awaiting it
    setImmediate(() => {
      startBackgroundEnrichment(leadsToEnrich, jobId).catch((err) => {
        console.error("❌ Background enrichment failed:", err);
        jobStore.setPhase(jobId, "completed");
      });
    });

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
