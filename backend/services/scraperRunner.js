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
puppeteer.use(StealthPlugin());

const badDomains = [
  "booking.com",
  "facebook.com",
  "instagram.com",
  "tripadvisor.com",
  "bit.ly",
  "justdial.com"
];

/* ============================================================
   ENRICH SINGLE LEAD
============================================================ */
async function enrichSingleLead(lead, jobId) {
  try {
    if (!lead || !lead.website || lead.status === "enriched") {
      jobStore.incEnrichDone(jobId);
      return;
    }

    if (badDomains.some(d => lead.website.includes(d))) {
      const score = calculateLeadScore({ phone: lead.phone, website: lead.website }, 0);
      await Lead.updateOne(
        { _id: lead._id },
        { $set: { leadQuality: score, enriched: true, enrichmentStatus: "done", status: "enriched" } }
      );
      jobStore.incEnrichDone(jobId);
      return;
    }

    let text;
    try {
      text = await lightExtract(lead.website);
      if (!text || text.length < 1500) {
        text = await extractWebsiteText(lead.website);
      }
    } catch {
      jobStore.incEnrichDone(jobId);
      return;
    }

    if (!text || text.length < 1500) {
      const score = calculateLeadScore({ phone: lead.phone, website: lead.website }, text?.length || 0);
      await Lead.updateOne(
        { _id: lead._id },
        { $set: { leadQuality: score, enriched: true, enrichmentStatus: "done", status: "enriched" } }
      );
      jobStore.incEnrichDone(jobId);
      return;
    }

    text = text.slice(0, 3000);
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
  } catch (err) {
    console.error("Enrichment error:", err.message);
  } finally {
    jobStore.incEnrichDone(jobId);
  }
}

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

/* ============================================================
   RUN FULL SCRAPER & ENRICHMENT PIPELINE
============================================================ */
export async function runScraperJob(query, jobId) {
  let browser;
  try {
    let user = await User.findOne({ username: "admin" });
    if (!user) {
      user = await User.create({ username: "admin", credits: 100 });
    }

    if (user.credits <= 0) {
      console.log("❌ [SCRAPER] No credits. Job stopped.");
      jobStore.setPhase(jobId, "completed");
      return;
    }

    const launchOpts = await getBrowserLaunchOptions();
    browser = await puppeteer.launch(launchOpts);

    console.log(`🚀 [SCRAPER] Launching job for query: "${query}" (Job ID: ${jobId})`);

    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    await page.goto(
      `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );

    // Auto-accept consent if redirected to consent page
    if (page.url().includes("consent.google.com")) {
      console.log("⚠️ Google consent page detected, bypassing...");
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const acceptBtn = btns.find(b => b.textContent.includes('Accept all') || b.textContent.includes('I agree'));
        if (acceptBtn) acceptBtn.click();
      });
      await new Promise(r => setTimeout(r, 2500));
    }

    await page.waitForSelector("a[href*='/maps/place'], a.hfpxzc", { timeout: 15000 }).catch(() => {});

    // Scroll and extract at least 35 place links (aiming for 30+ leads)
    let links = [];
    let noNewLinksCount = 0;
    const TARGET_COUNT = 35;

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

      await new Promise(r => setTimeout(r, 1200));

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
        break;
      }

      if (links.length === currentCount) {
        noNewLinksCount++;
        if (noNewLinksCount > 5) break;
      } else {
        noNewLinksCount = 0;
      }
    }

    links = links.slice(0, 35);
    console.log(`📊 [SCRAPER] Collected ${links.length} place links for "${query}"`);
    jobStore.setScrapeTotal(jobId, links.length);

    if (links.length === 0) {
      console.log("⚠️ [SCRAPER] 0 links found. Job completed.");
      jobStore.setPhase(jobId, "completed");
      return;
    }

    const CHUNK_SIZE = 5;
    const leadsToEnrich = [];

    for (let i = 0; i < links.length; i += CHUNK_SIZE) {
      const chunk = links.slice(i, i + CHUNK_SIZE);
      const batchData = [];

      await Promise.all(chunk.map(async (link) => {
        const p = await browser.newPage();
        try {
          await p.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
          await p.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

          const currentUser = await User.findOne({ username: "admin" });
          if (currentUser && currentUser.credits <= 0) return;

          await p.goto(link, { waitUntil: "domcontentloaded", timeout: 15000 });
          await p.waitForSelector("h1", { timeout: 5000 });

          const name = await p.$eval("h1", el => el.innerText);

          let address = await p.$eval(
            'button[data-item-id="address"]',
            el => el.innerText
          ).catch(() => null);
          if (address) address = address.replace(/[\u200B-\u200F\u202A-\u202E\uE000-\uF8FF\uFFFD]/g, "").replace(/[^\p{L}\p{N}\p{P}\p{Z}+=]/gu, "").trim();

          let phone = await p.$eval(
            'button[data-item-id^="phone"]',
            el => el.innerText
          ).catch(() => null);
          if (phone) phone = phone.replace(/[^\d+\-\s()]/g, "").trim();

          let website = await p.$eval(
            'a[data-item-id="authority"]',
            el => el.href
          ).catch(() => null);

          if (!website) {
            website = await p.$eval(
              'a[aria-label^="Website"]',
              el => el.href
            ).catch(() => null);
          }

          batchData.push({ name, address, phone, website, sourceQuery: query });

        } catch (err) {
          // Ignore individual page errors
        } finally {
          await p.close().catch(() => {});
          jobStore.incScrapeDone(jobId);
        }
      }));

      if (batchData.length > 0) {
        user = await User.findOne({ username: "admin" });
        if (user && user.credits <= 0) break;

        const savedLeads = await Promise.all(
          batchData.map(async (l) => {
            if (l.website) {
              return await Lead.findOneAndUpdate(
                { website: l.website },
                { $set: { ...l, enriched: false, enrichmentStatus: "pending" } },
                { upsert: true, returnDocument: "after" }
              );
            } else {
              return await Lead.create({
                ...l,
                website: `no-website-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                leadQuality: calculateLeadScore(l, 0),
                status: "enriched",
                enriched: true,
                enrichmentStatus: "done"
              });
            }
          })
        );

        const validLeads = savedLeads.filter(
          l => l && l.website && !l.website.startsWith("no-website")
        );

        if (validLeads.length > 0) {
          const deductAmount = validLeads.length;
          user = await User.findOne({ username: "admin" });
          if (user && user.credits >= deductAmount) {
            user.credits -= deductAmount;
            await user.save();
            leadsToEnrich.push(...validLeads);
          }
        }
      }
    }

    // Process enrichment phase
    if (leadsToEnrich.length > 0) {
      console.log(`✨ [SCRAPER] Enriching ${leadsToEnrich.length} valid leads...`);
      jobStore.incEnrichTotal(jobId, leadsToEnrich.length);
      jobStore.setPhase(jobId, "enriching");

      for (const lead of leadsToEnrich) {
        await enrichSingleLead(lead, jobId);
      }
    }

    jobStore.setPhase(jobId, "completed");

  } catch (err) {
    console.error("Scraper job error:", err);
    jobStore.setPhase(jobId, "completed");
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
