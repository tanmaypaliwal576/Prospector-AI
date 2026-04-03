import exceljs from "exceljs";
import Lead from "../models/Lead.js";

/**
 * Clean + escape values for CSV (Excel-safe)
 */
function safeCSV(value) {
  if (value === null || value === undefined || value === "") return "null";

  let str = String(value)
    .replace(/[\u200B-\u200F\u202A-\u202E\uE000-\uF8FF\uFFFD]/g, "") 
    .replace(/[^\p{L}\p{N}\p{P}\p{Z}\p{Sc}+=|<>^~]/gu, "") 
    .replace(/\r?\n|\r/g, " | ")         
    .replace(/\s+/g, " ")                
    .replace(/"/g, '""')                 
    .trim();

  if (str === "") return "null";

  return `"${str}"`; 
}

/**
 * Limit long text (prevents ugly wide cells without cutting off too much)
 */
function truncate(text, max = 500) {
  if (!text) return "";
  const str = String(text);
  return str.length > max ? str.slice(0, max) + "..." : str;
}

/**
 * CSV Export Function
 */
export const exportLeadsToCSV = async (res) => {
  try {
    const headers = [
      "Name", "Website", "Phone", "Address", "Services", "Business Type", "Description", "Owner Name", "Email", "Lead Quality"
    ].join(",");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=leads.csv");
    res.write("\uFEFF");
    res.write(headers + "\n");

    const cursor = Lead.find({}).lean().cursor();
    let count = 0;

    for await (const lead of cursor) {
      const row = [
        safeCSV(lead.name),
        safeCSV(lead.website),
        safeCSV(lead.phone),
        safeCSV(truncate(lead.address, 500)),
        safeCSV((lead.services || []).join(" | ")),
        safeCSV(lead.businessType),
        safeCSV(truncate(lead.description, 800)),
        safeCSV(truncate(lead.ownerName, 200)),
        safeCSV(truncate(lead.emailGuess, 200)),
        safeCSV(lead.leadQuality),
      ].join(",");

      res.write(row + "\n");
      count++;
    }

    res.end();
    console.log(`📤 CSV Exported: ${count} leads`);
  } catch (err) {
    console.error("❌ CSV Export Error:", err);
    if (!res.headersSent) res.status(500).json({ error: "CSV export failed" });
    else res.end();
  }
};

/**
 * Excel Export Function
 */
export const exportLeadsToExcel = async (res) => {
  try {
    const workbook = new exceljs.Workbook();
    const worksheet = workbook.addWorksheet('Leads');

    worksheet.columns = [
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Website', key: 'website', width: 35 },
      { header: 'Phone', key: 'phone', width: 20 },
      { header: 'Address', key: 'address', width: 50 },
      { header: 'Services', key: 'services', width: 40 },
      { header: 'Business Type', key: 'businessType', width: 20 },
      { header: 'Description', key: 'description', width: 50 },
      { header: 'Owner Name', key: 'ownerName', width: 20 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Lead Quality', key: 'leadQuality', width: 15 }
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFC6E0B4' }
      };
      cell.font = { bold: true };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
      };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=leads.xlsx');

    const cursor = Lead.find({}).lean().cursor();
    let count = 0;

    for await (const lead of cursor) {
      worksheet.addRow({
        name: lead.name || "null",
        website: lead.website || "null",
        phone: lead.phone || "null",
        address: lead.address || "null",
        services: (lead.services || []).join(" | ") || "null",
        businessType: lead.businessType || "null",
        description: lead.description || "null",
        ownerName: lead.ownerName || "null",
        email: lead.emailGuess || "null",
        leadQuality: lead.leadQuality || "null",
      });
      count++;
    }

    await workbook.xlsx.write(res);
    res.end();
    console.log(`📤 Excel Exported: ${count} leads`);
  } catch (err) {
    console.error("❌ Excel Export Error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Excel export failed" });
    else res.end();
  }
};