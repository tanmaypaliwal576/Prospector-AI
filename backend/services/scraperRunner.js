import fs from "fs";
import v8 from "v8";
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
  "window.outerdimensions", "user-agent-override", "navigator.webdriver"
].forEach(name => stealth.enabledEvasions.delete(name));
puppeteer.use(stealth);

process.on("unhandledRejection", (reason) => {
  console.error("🔥 [scraperRunner] Unhandled rejection (contained):", reason?.message || reason);
});

function getTS() {
  return `[TS: ${new Date().toISOString().split("T")[1].slice(0, 12)}]`;
}

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
        "--disable-blink-features=AutomationControlled"
      ],
      protocolTimeout: 60000
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
      "--disable-sync",
      "--disable-translate",
      "--metrics-recording-only",
      "--no-first-run",
      "--disable-blink-features=AutomationControlled"
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    protocolTimeout: 60000
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
  console.log(`${getTS()} safeClosePage() initiated...`);
  try {
    page.removeAllListeners("request");
    page.removeAllListeners("error");
    page.removeAllListeners("pageerror");
    await page.close().catch(() => {});
    console.log(`${getTS()} safeClosePage() completed.`);
  } catch (e) {
    console.log(`${getTS()} safeClosePage() error: ${e.message}`);
  }
}

/**
 * PRODUCTION-HARDENED BROWSER MANAGER WITH SINGLE RECYCLER ELECTION
 */
class BrowserManager {
  constructor() {
    this.browser = null;
    this.epoch = 0;
    this.recentFailures = [];
    this.createMutex = Promise.resolve();
    this.totalProcessed = 0;
    this.recycleRequested = false;
    this.recycleInProgress = false;
  }

  async launch() {
    console.log(`${getTS()} BrowserManager.launch() initiated...`);
    const launchOpts = await getBrowserLaunchOptions();
    this.browser = await withTimeout(puppeteer.launch(launchOpts), 60000, "Browser launch");
    this.recentFailures = [];
    this.epoch++;
    console.log(`${getTS()} BrowserManager.launch() completed successfully (Epoch: ${this.epoch}).`);
    return this.browser;
  }

  tryBecomeRecycler() {
    if (this.recycleRequested && !this.recycleInProgress) {
      this.recycleInProgress = true;
      return true;
    }
    return false;
  }

  async isHealthy() {
    if (!this.browser || !this.browser.isConnected()) return false;
    try {
      await withTimeout(this.browser.version(), 3000, "CDP Health Check Version");
      await withTimeout(this.browser.pages(), 3000, "CDP Health Check Pages");
      return true;
    } catch (e) {
      console.log(`${getTS()} ⚠️ CDP Health Check failed: ${e.message}`);
      return false;
    }
  }

  async createPage(workerId) {
    const release = await this.acquireMutex();
    try {
      console.log(`${getTS()} [WORKER #${workerId}] BrowserManager.createPage() requested...`);
      
      const healthy = await this.isHealthy();
      if (!healthy) {
        console.log(`${getTS()} [WORKER #${workerId}] Browser unhealthy. Triggering restart...`);
        await this.restartInner();
      }

      await new Promise(r => setTimeout(r, 500));

      const page = await withTimeout(this.browser.newPage(), 45000, `Worker-${workerId} newPage`);
      console.log(`${getTS()} [WORKER #${workerId}] BrowserManager.createPage() succeeded.`);

      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
      await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
      await blockHeavyResources(page);
      page.setDefaultNavigationTimeout(25000);
      page.setDefaultTimeout(10000);
      return { page, epoch: this.epoch };

    } catch (err) {
      console.error(`${getTS()} ❌ [WORKER #${workerId}] createPage failed: ${err.message}`);
      await this.restartInner();
      const freshPage = await withTimeout(this.browser.newPage(), 45000, `Worker-${workerId} newPage-Retry`);
      await freshPage.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
      await freshPage.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
      await blockHeavyResources(freshPage);
      freshPage.setDefaultNavigationTimeout(25000);
      freshPage.setDefaultTimeout(10000);
      return { page: freshPage, epoch: this.epoch };
    } finally {
      release();
    }
  }

  async acquireMutex() {
    let release;
    const nextMutex = new Promise(resolve => {
      release = resolve;
    });
    const currentMutex = this.createMutex;
    this.createMutex = currentMutex.then(() => nextMutex);
    await currentMutex;
    return release;
  }

  async incrementProcessedAndCheckRecycle() {
    this.totalProcessed++;
    if (this.totalProcessed >= 50) {
      console.log(`${getTS()} 🔄 Proactive browser recycling requested after ${this.totalProcessed} items.`);
      this.recycleRequested = true;
    }
  }

  async recordFailureAndCheckRestart() {
    const now = Date.now();
    this.recentFailures = this.recentFailures.filter(t => now - t < 30000);
    this.recentFailures.push(now);
    if (this.recentFailures.length >= 3) {
      console.log(`${getTS()} ⚠️ [BROWSER MANAGER] ${this.recentFailures.length} failures within 30s. Restarting browser...`);
      await this.restart();
      return true;
    }
    return false;
  }

  async restart() {
    const release = await this.acquireMutex();
    try {
      await this.restartInner();
    } finally {
      release();
    }
  }

  async restartInner() {
    console.log(`${getTS()} BrowserManager.restart() initiated...`);
    if (this.browser) {
      try {
        await this.browser.close().catch(() => {});
      } catch (e) {}
      this.browser = null;
    }
    await new Promise(r => setTimeout(r, 1500));
    await this.launch();
    this.recycleRequested = false;
    this.recycleInProgress = false;
    this.totalProcessed = 0;
    console.log(`${getTS()} ✨ BrowserManager.restart() completed (Epoch: ${this.epoch}).`);
  }

  async close() {
    console.log(`${getTS()} BrowserManager.close() initiated...`);
    if (this.browser) {
      try {
        await this.browser.close().catch(() => {});
        console.log(`${getTS()} BrowserManager.close() completed.`);
      } catch (e) {}
      this.browser = null;
    }
  }
}

/* ============================================================
   ENRICH SINGLE LEAD
============================================================ */
async function enrichSingleLead(lead, jobId, index, totalCount) {
  console.log(`${getTS()} [ENRICH STEP 1] Starting lead ${index + 1}/${totalCount}: ${lead.website}`);
  const startTime = Date.now();
  try {
    if (!lead || !lead.website || lead.status === "enriched") {
      console.log(`${getTS()} [ENRICH STEP 2] Lead ${index + 1} already enriched or invalid. Skipping.`);
      return 0;
    }

    if (badDomains.some(d => lead.website.includes(d))) {
      console.log(`${getTS()} [ENRICH STEP 3] Lead ${index + 1} is aggregator domain. Scoring directly.`);
      const score = calculateLeadScore({ phone: lead.phone, website: lead.website }, 0);
      await Lead.updateOne(
        { _id: lead._id },
        { $set: { leadQuality: score, enriched: true, enrichmentStatus: "done", status: "enriched" } }
      );
      return Date.now() - startTime;
    }

    console.log(`${getTS()} [ENRICH STEP 4] Extracting text for lead ${index + 1}: ${lead.website}`);
    let text;
    try {
      text = await lightExtract(lead.website);
      if (!text || text.length < 1500) {
        text = await extractWebsiteText(lead.website);
      }
    } catch (extractErr) {
      console.log(`${getTS()} [ENRICH STEP 5] Extraction failed for lead ${index + 1}: ${extractErr.message}`);
      return Date.now() - startTime;
    }

    if (!text || text.length < 1500) {
      console.log(`${getTS()} [ENRICH STEP 6] Low text content (${text?.length || 0} chars) for lead ${index + 1}. Scoring manually.`);
      const score = calculateLeadScore({ phone: lead.phone, website: lead.website }, text?.length || 0);
      await Lead.updateOne(
        { _id: lead._id },
        { $set: { leadQuality: score, enriched: true, enrichmentStatus: "done", status: "enriched" } }
      );
      return Date.now() - startTime;
    }

    text = text.slice(0, 3000);
    console.log(`${getTS()} [ENRICH STEP 7] Sending ${text.length} chars to Gemini AI for lead ${index + 1}...`);
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

    console.log(`${getTS()} [ENRICH STEP 8] Gemini response received. Updating DB for lead ${index + 1} (Score: ${score})...`);
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
    console.log(`${getTS()} [ENRICH STEP 9] Lead ${index + 1}/${totalCount} successfully enriched.`);
    return Date.now() - startTime;

  } catch (err) {
    console.error(`${getTS()} [ENRICH ERROR] Failed lead ${index + 1}:`, err.message);
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
    console.log(`${getTS()} Enrichment Finished (0 leads to enrich)`);
    jobStore.setPhase(jobId, "completed");
    return;
  }

  console.log(`${getTS()} Enrichment Started`);
  const ENRICH_CONCURRENCY = 3;
  const enrichStart = Date.now();
  const enrichDurations = [];
  let enrichQueueIndex = 0;

  async function enrichWorker(workerId) {
    while (enrichQueueIndex < leadsToEnrich.length) {
      const idx = enrichQueueIndex++;
      if (idx >= leadsToEnrich.length) break;

      const lead = leadsToEnrich[idx];
      console.log(`${getTS()} [ENRICH WORKER #${workerId}] Enriching lead ${idx + 1}/${leadsToEnrich.length}: ${lead.website}`);
      const dur = await enrichSingleLead(lead, jobId, idx, leadsToEnrich.length);
      if (dur > 0) enrichDurations.push(dur);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ENRICH_CONCURRENCY, leadsToEnrich.length) }, (_, i) => enrichWorker(i + 1))
  );

  const avgGeminiTime = enrichDurations.length ? Math.round(enrichDurations.reduce((a, b) => a + b, 0) / enrichDurations.length) : 0;
  console.log(`${getTS()} Average Gemini Time: ${avgGeminiTime} ms`);
  console.log(`${getTS()} Enrichment Finished`);
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
    console.error(`${getTS()} ❌ [SCRAPER JOB FAILED/TIMED OUT]:`, err.message);
    jobStore.setError(jobId, err.message);
  }
}

async function runScraperJobInner(query, jobId) {
  const browserMgr = new BrowserManager();
  const scrapeStartTime = Date.now();

  try {
    console.log(`${getTS()} Scrape Started`);
    console.log(`\n========================================`);
    console.log(`${getTS()} [STEP 1] Starting Scraper Job for query: "${query}" (ID: ${jobId})`);
    console.log(`========================================`);

    let user = await User.findOne({ username: "admin" });
    if (!user) {
      console.log(`${getTS()} [STEP 1.1] Admin user not found. Creating default admin user.`);
      user = await User.create({ username: "admin", credits: 100 });
    }

    if (user.credits <= 0) {
      console.log(`${getTS()} ❌ [STEP 1.2] Admin out of credits. Halting job.`);
      jobStore.setPhase(jobId, "completed");
      return;
    }

    console.log(`${getTS()} [STEP 2] Launching Chromium browser instance with Render-optimized flags...`);
    await browserMgr.launch();
    console.log(`${getTS()} [STEP 2.1] Chromium browser launched successfully.`);

    console.log(`${getTS()} [STEP 3] Opening main browser tab...`);
    const { page } = await browserMgr.createPage(0);

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;
    console.log(`${getTS()} [STEP 4] Navigating to Google Maps search: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
    console.log(`${getTS()} [STEP 4.1] Google Maps page loaded.`);

    if (page.url().includes("consent.google.com")) {
      console.log(`${getTS()} [STEP 4.2] Bypassing Google Consent page...`);
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const acceptBtn = btns.find(b => b.textContent.includes('Accept all') || b.textContent.includes('I agree'));
        if (acceptBtn) acceptBtn.click();
      });
      await new Promise(r => setTimeout(r, 700));
    }

    console.log(`${getTS()} [STEP 5] Waiting for Google Maps place link selectors...`);
    await page.waitForSelector("a[href*='/maps/place'], a.hfpxzc", { timeout: 15000 }).catch(() => {
      console.log(`${getTS()} [STEP 5.1] Initial selector wait timed out, continuing scroll search...`);
    });

    console.log(`${getTS()} [STEP 6] Scrolling results feed to collect place links...`);
    let links = [];
    let noNewLinksCount = 0;
    const TARGET_COUNT = Number(process.env.MAX_LEADS) || 35;

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
        console.log(`${getTS()} [STEP 6.1] Target link count reached (${links.length}). Stopping scroll loop.`);
        break;
      }

      if (links.length === currentCount) {
        noNewLinksCount++;
        if (noNewLinksCount > 5) {
          console.log(`${getTS()} [STEP 6.2] End of results feed reached at ${links.length} links.`);
          break;
        }
      } else {
        noNewLinksCount = 0;
      }
    }

    links = links.slice(0, TARGET_COUNT);
    console.log(`${getTS()} [STEP 7] Final place links collected: ${links.length}`);
    jobStore.setScrapeTotal(jobId, links.length);

    if (links.length === 0) {
      console.log(`${getTS()} [STEP 7.1] No place links extracted. Job complete.`);
      jobStore.setPhase(jobId, "completed");
      return;
    }

    await safeClosePage(page);

    // ============================================================
    // WORKER POOL CONCURRENCY = 2 WITH SINGLE RECYCLER ELECTION
    // ============================================================
    const WORKER_COUNT = 2;
    console.log(`${getTS()} [STEP 8] Initializing Worker Pool of ${WORKER_COUNT} reusable detail pages...`);

    let queueIndex = 0;
    let availableCredits = user.credits;
    const extractedResults = [];
    const pageLoadTimes = [];
    const extractionTimes = [];
    const workerIdleTimes = [];

    function setupPageCrashListeners(worker) {
      if (!worker.page) return;
      worker.page.on("error", () => {
        console.log(`${getTS()} [WORKER #${worker.id}] Page crash detected via error event.`);
        worker.crashed = true;
      });
      worker.page.on("pageerror", () => {
        console.log(`${getTS()} [WORKER #${worker.id}] Page error event detected.`);
      });
    }

    const workers = [];
    for (let id = 1; id <= WORKER_COUNT; id++) {
      const { page: workerPage, epoch } = await browserMgr.createPage(id);
      const wObj = {
        id,
        page: workerPage,
        epoch,
        itemsProcessed: 0,
        busyTime: 0,
        idleStart: Date.now(),
        failCount: 0,
        crashed: false,
        active: false
      };
      setupPageCrashListeners(wObj);
      workers.push(wObj);
      await new Promise(r => setTimeout(r, 300));
    }

    async function runWorker(worker) {
      while (true) {
        if (availableCredits <= 0) break;

        // V8 Heap Statistics Memory Monitor
        if (queueIndex % 10 === 0) {
          const heapStats = v8.getHeapStatistics();
          const heapUsedMB = (heapStats.used_heap_size / 1024 / 1024).toFixed(2);
          const heapLimitMB = (heapStats.heap_size_limit / 1024 / 1024).toFixed(2);
          const ratio = heapStats.used_heap_size / heapStats.heap_size_limit;
          console.log(`${getTS()} 🧠 [V8 MEMORY MONITOR] Heap Used: ${heapUsedMB} MB / Limit: ${heapLimitMB} MB (${(ratio * 100).toFixed(1)}%)`);
          if (ratio > 0.80) {
            console.log(`${getTS()} ⚠️ Heap usage > 80%. Flagging graceful proactive recycle...`);
            browserMgr.recycleRequested = true;
          }
        }

        // Single Recycler Election Architecture
        if (browserMgr.recycleRequested) {
          worker.active = false;

          if (browserMgr.tryBecomeRecycler()) {
            console.log(`${getTS()} 👑 [WORKER #${worker.id}] Elected as Single Recycler. Waiting for all workers to become idle...`);
            while (workers.some(w => w.active)) {
              await new Promise(r => setTimeout(r, 100));
            }
            console.log(`${getTS()} 👑 [WORKER #${worker.id}] All workers idle. Restarting browser...`);
            await browserMgr.restart();
          } else {
            console.log(`${getTS()} [WORKER #${worker.id}] Waiting for elected recycler to complete browser restart...`);
            while (browserMgr.recycleInProgress) {
              await new Promise(r => setTimeout(r, 100));
            }
          }
        }

        // Resynchronize worker if crashed or browser epoch changed
        if (worker.crashed || worker.epoch !== browserMgr.epoch) {
          console.log(`${getTS()} [WORKER #${worker.id}] Resynchronizing crashed/outdated page with Browser Epoch ${browserMgr.epoch}...`);
          await safeClosePage(worker.page);
          const fresh = await browserMgr.createPage(worker.id);
          worker.page = fresh.page;
          worker.epoch = fresh.epoch;
          worker.itemsProcessed = 0;
          worker.crashed = false;
          setupPageCrashListeners(worker);
        }

        let currentIndex;
        if (queueIndex >= links.length) break;
        currentIndex = queueIndex++;

        const link = links[currentIndex];
        if (!link) break;

        worker.active = true;
        const idleDuration = Date.now() - worker.idleStart;
        workerIdleTimes.push(idleDuration);

        // Periodic Page Refresh every 15 items
        if (worker.itemsProcessed >= 15) {
          console.log(`${getTS()} [WORKER #${worker.id}] Refreshing worker page after 15 items...`);
          await safeClosePage(worker.page);
          const fresh = await browserMgr.createPage(worker.id);
          worker.page = fresh.page;
          worker.epoch = fresh.epoch;
          worker.itemsProcessed = 0;
          worker.crashed = false;
          setupPageCrashListeners(worker);
        }

        console.log(`${getTS()} [WORKER #${worker.id}] Processing link ${currentIndex + 1}/${links.length}`);
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
                console.log(`${getTS()} [WORKER #${worker.id}] Navigation failed for link ${currentIndex + 1}: ${navErr.message}`);
                worker.failCount++;

                await browserMgr.recordFailureAndCheckRestart();
                
                const backoffMs = Math.min(1000 * Math.pow(2, worker.failCount), 8000);
                await new Promise(r => setTimeout(r, backoffMs));

                console.log(`${getTS()} Worker Restarted (Worker #${worker.id})`);
                await safeClosePage(worker.page);
                const fresh = await browserMgr.createPage(worker.id);
                worker.page = fresh.page;
                worker.epoch = fresh.epoch;
                worker.itemsProcessed = 0;
                worker.crashed = false;
                setupPageCrashListeners(worker);
              }
            }
          }

          const navDuration = Date.now() - navStart;
          pageLoadTimes.push(navDuration);
          console.log(`${getTS()} [WORKER #${worker.id}] Page loaded in ${navDuration} ms for link ${currentIndex + 1}`);

          if (!navSuccess) {
            jobStore.incScrapeDone(jobId);
            worker.idleStart = Date.now();
            worker.active = false;
            continue;
          }

          const extractStart = Date.now();

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
          console.log(`${getTS()} [WORKER #${worker.id}] Extraction completed in ${extractDuration} ms for link ${currentIndex + 1}`);

          if (data && data.name) {
            extractedResults.push({ ...data, sourceQuery: query });
            if (data.website) {
              availableCredits--;
            }
          }

          worker.itemsProcessed++;
          worker.busyTime += (navDuration + extractDuration);

          await browserMgr.incrementProcessedAndCheckRecycle();

        } catch (err) {
          console.log(`${getTS()} [WORKER #${worker.id}] Error processing link ${currentIndex + 1}: ${err.message}`);
          worker.failCount++;
          await browserMgr.recordFailureAndCheckRestart();
          
          const backoffMs = Math.min(1000 * Math.pow(2, worker.failCount), 8000);
          await new Promise(r => setTimeout(r, backoffMs));

          console.log(`${getTS()} Worker Restarted (Worker #${worker.id})`);
          await safeClosePage(worker.page);
          const fresh = await browserMgr.createPage(worker.id);
          worker.page = fresh.page;
          worker.epoch = fresh.epoch;
          worker.itemsProcessed = 0;
          worker.crashed = false;
          setupPageCrashListeners(worker);
        } finally {
          jobStore.incScrapeDone(jobId);
          worker.idleStart = Date.now();
          worker.active = false;
        }
      }
      console.log(`${getTS()} [WORKER #${worker.id}] Finished all assigned work.`);
    }

    await Promise.all(workers.map(w => runWorker(w)));

    await Promise.all(workers.map(w => safeClosePage(w.page)));

    // ============================================================
    // BULK WRITE & SINGLE CREDIT SAVING
    // ============================================================
    const dbWriteStart = Date.now();
    const leadsToEnrich = [];
    let dbWriteDuration = 0;

    if (extractedResults.length > 0) {
      console.log(`${getTS()} [STEP 8.2] Preparing bulkWrite for ${extractedResults.length} extracted leads...`);
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
      console.log(`${getTS()} [STEP 8.3] Lead.bulkWrite completed in ${dbWriteDuration} ms (Inserted: ${bulkResult.insertedCount || 0}, Upserted: ${bulkResult.upsertedCount || 0}, Modified: ${bulkResult.modifiedCount || 0}).`);

      const validResults = extractedResults.filter(r => r.website);
      if (validResults.length > 0) {
        const deductAmount = validResults.length;
        if (user.credits >= deductAmount) {
          user.credits -= deductAmount;
          await user.save();
          console.log(`${getTS()} [STEP 8.4] Single credit deduction completed (${deductAmount} credits deducted). Remaining: ${user.credits}`);
        }

        const validWebsites = validResults.map(r => r.website);
        const savedLeads = await Lead.find({ website: { $in: validWebsites } }).lean();
        leadsToEnrich.push(...savedLeads);
      }
    }

    console.log(`${getTS()} [STEP 9] Closing Google Maps Puppeteer browser instance...`);
    await browserMgr.close();
    console.log(`${getTS()} [STEP 9.1] Google Maps browser closed cleanly.`);

    const totalScrapeDuration = Date.now() - scrapeStartTime;
    const avgNavigation = pageLoadTimes.length ? Math.round(pageLoadTimes.reduce((a, b) => a + b, 0) / pageLoadTimes.length) : 0;
    const avgExtraction = extractionTimes.length ? Math.round(extractionTimes.reduce((a, b) => a + b, 0) / extractionTimes.length) : 0;
    const totalIdleTime = workerIdleTimes.length ? Math.round(workerIdleTimes.reduce((a, b) => a + b, 0)) : 0;
    const totalBusyTime = workers.reduce((acc, w) => acc + w.busyTime, 0);
    const workerBusyPercent = (totalBusyTime + totalIdleTime) > 0 ? ((totalBusyTime / (totalBusyTime + totalIdleTime)) * 100).toFixed(1) : "100.0";
    const workerIdlePercent = (100 - parseFloat(workerBusyPercent)).toFixed(1);
    const peakMemoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    console.log(`${getTS()} Scrape Finished`);
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

    console.log(`${getTS()} [STEP 9.2] Scraping complete. Returning control immediately to frontend.`);
    jobStore.setPhase(jobId, "enriching");

    setImmediate(() => {
      startBackgroundEnrichment(leadsToEnrich, jobId).catch((err) => {
        console.error(`${getTS()} ❌ Background enrichment failed:`, err);
        jobStore.setPhase(jobId, "completed");
      });
    });

  } catch (err) {
    console.error(`${getTS()} ❌ [SCRAPER FATAL ERROR]:`, err);
    jobStore.setError(jobId, err.message || "Scraper failed");
    throw err;
  } finally {
    await browserMgr.close();
  }
}
