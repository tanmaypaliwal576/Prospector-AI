import Lead from "../models/Lead.js";

/**
 * Clean + escape values for CSV (Excel-safe)
 */
function safeCSV(value) {
  if (value === null || value === undefined || value === "") return "null";

  let str = String(value)
    .replace(/[\u200B-\u200F\u202A-\u202E\uE000-\uF8FF\uFFFD]/g, "") // strip bidi markers and private use icons
    .replace(/[^\p{L}\p{N}\p{P}\p{Z}\p{Sc}+=|<>^~]/gu, "") // strip other emojis/icons, keep text/numbers/punctuation/spaces/currencies/math
    .replace(/\r?\n|\r/g, " | ")         // remove line breaks
    .replace(/\s+/g, " ")                // normalize spaces
    .replace(/"/g, '""')                 // escape quotes
    .trim();

  if (str === "") return "null";

  return `"${str}"`; // ALWAYS wrap in quotes
}

/**
 * Limit long text (prevents ugly wide cells)
 */
function truncate(text, max = 120) {
  if (!text) return "";
  const str = String(text);
  return str.length > max ? str.slice(0, max) + "..." : str;
}

/**
 * CSV Export Function
 */
export const exportLeadsToCSV = async (res) => {
  try {
    // ✅ Clean readable headers
    const headers = [
      "Name",
      "Website",
      "Phone",
      "Address",
      "Services",
      "Business Type",
      "Description",
      "Owner Name",
      "Email",
      "Lead Quality"
    ].join(",");

    // ✅ Required headers for download
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=leads.csv");

    // 🔥 CRITICAL: Fix Excel encoding issue
    res.write("\uFEFF");

    // Write header row
    res.write(headers + "\n");

    const cursor = Lead.find({}).lean().cursor();
    let count = 0;

    // Write data rows progressively
    for await (const lead of cursor) {
      const row = [
        safeCSV(lead.name),
        safeCSV(lead.website),
        safeCSV(lead.phone),
        safeCSV(truncate(lead.address, 100)),
        safeCSV((lead.services || []).join(" | ")),
        safeCSV(lead.businessType),
        safeCSV(truncate(lead.description, 120)),
        safeCSV(lead.ownerName),
        safeCSV(lead.emailGuess),
        safeCSV(lead.leadQuality),
      ].join(",");

      res.write(row + "\n");
      count++;
    }

    res.end();

    console.log(`📤 CSV Exported: ${count} leads`);

  } catch (err) {
    console.error("❌ CSV Export Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "CSV export failed" });
    } else {
      res.end();
    }
  }
};