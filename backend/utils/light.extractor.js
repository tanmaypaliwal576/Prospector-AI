import axios from "axios";
import * as cheerio from "cheerio";

export const lightExtract = async (url) => {
  try {
    const { data } = await axios.get(url, {
      timeout: 5000,
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const $ = cheerio.load(data);

    return $("body").text().replace(/\s+/g, " ").trim();

  } catch {
    return null;
  }
};