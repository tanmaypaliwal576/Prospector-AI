import he from "he";
import validator from "validator";
import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Normalize and clean raw text
 */
export function cleanText(text) {
  if (!text) return "";

  let cleaned = text;

  try {
    // Decode HTML entities
    cleaned = he.decode(cleaned);

    // Normalize unicode
    cleaned = cleaned.normalize("NFKC");

    // Remove replacement characters (ï¿½)
    cleaned = cleaned.replace(/\uFFFD/g, "");

    // Remove control characters
    cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, "");

    // Collapse multiple spaces
    cleaned = cleaned.replace(/\s+/g, " ").trim();
  } catch (err) {
    return "";
  }

  return cleaned;
}

/**
 * Clean and normalize business name
 */
export function cleanName(name) {
  const cleaned = cleanText(name);

  return cleaned
    .replace(/[^\w\s&.,'-]/g, "") // remove weird symbols
    .trim();
}

/**
 * Clean address
 */
export function cleanAddress(address) {
  return cleanText(address);
}

/**
 * Normalize website URL
 */
export function cleanWebsite(url) {
  if (!url) return null;

  let cleaned = cleanText(url);

  // Remove spaces
  cleaned = cleaned.replace(/\s/g, "");

  // Add protocol if missing
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = "https://" + cleaned;
  }

  try {
    const parsed = new URL(cleaned);

    // Remove tracking params
    parsed.search = "";

    // Normalize hostname
    parsed.hostname = parsed.hostname.replace(/^www\./, "");

    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Normalize phone number (India default)
 */
export function cleanPhone(phone) {
  if (!phone) return null;

  const cleaned = cleanText(phone);

  try {
    const parsed = parsePhoneNumberFromString(cleaned, "IN");

    if (!parsed || !parsed.isValid()) return null;

    return parsed.formatInternational(); // +91 format
  } catch {
    return null;
  }
}

/**
 * Safe number parsing
 */
export function cleanNumber(value) {
  const num = Number(value);
  return isNaN(num) ? null : num;
}

/**
 * FINAL PIPELINE CLEANER (USE THIS)
 */
export function cleanLead(raw) {
  return {
    name: cleanName(raw.name),
    address: cleanAddress(raw.address),
    phone: cleanPhone(raw.phone),
    website: cleanWebsite(raw.website),
    rating: cleanNumber(raw.rating),
    reviews: cleanNumber(raw.reviews) || 0,
  };
}