import axios from "axios";
import * as cheerio from "cheerio";

export const extractWebsiteText = async (url) => {

  try {

    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const $ = cheerio.load(data);

    $("script, style, noscript").remove();

    const text = $("body").text();

    const cleaned = text
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);

    return cleaned;

  } catch (error) {

    console.log("Website extraction failed:", url);

    return null;

  }

};