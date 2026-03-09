import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

export const scrapeGoogleMaps = async (query) => {

    const browser = await puppeteer.launch({
        headless: true
    });

    const page = await browser.newPage();

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

    await page.goto(searchUrl, { waitUntil: "networkidle2" });

  await new Promise(resolve => setTimeout(resolve, 5000));

    const results = await page.evaluate(() => {

        const businesses = [];

        const cards = document.querySelectorAll("div.Nv2PK");

        cards.forEach(card => {

            const name =
                card.querySelector(".qBF1Pd")?.innerText || "";

            const rating =
                card.querySelector(".MW4etd")?.innerText || "";

            const reviews =
                card.querySelector(".UY7F9")?.innerText || "";

            const website =
                card.querySelector("a.hfpxzc")?.href || "";

            businesses.push({
                name,
                rating,
                reviews,
                website
            });

        });

        return businesses;

    });

    await browser.close();

    return results;
};