import axios from "axios";
import * as cheerio from "cheerio";

export const lightExtract = async (url) => {
  try {
    const { data } = await axios.get(url, {
      timeout: 7000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);

    $("script, style, noscript").remove();

    const text = $("body").text().replace(/\s+/g, " ").trim();

    return text.slice(0, 15000);

  } catch {
    return null;
  }
};