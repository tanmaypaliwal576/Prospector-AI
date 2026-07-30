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
    res.setHeader("Content-Disposition", 'attachment; filename="leads.csv"');
    
    let csvData = "\uFEFF" + headers + "\n";

    const leads = await Lead.find({}).lean();

    for (const lead of leads) {
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

      csvData += row + "\n";
    }

    res.send(csvData);
    console.log(`📤 CSV Exported: ${leads.length} leads`);
  } catch (err) {
    console.error("❌ CSV Export Error:", err);
    if (!res.headersSent) res.status(500).json({ error: "CSV export failed" });
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

    const leads = await Lead.find({}).lean();

    for (const lead of leads) {
      worksheet.addRow({
        name: lead.name || "",
        website: lead.website || "",
        phone: lead.phone || "",
        address: lead.address || "",
        services: (lead.services || []).join(" | "),
        businessType: lead.businessType || "",
        description: lead.description || "",
        ownerName: lead.ownerName || "",
        email: lead.emailGuess || "",
        leadQuality: lead.leadQuality || "",
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
    console.log(`📤 Excel Exported: ${leads.length} leads`);
  } catch (err) {
    console.error("❌ Excel Export Error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Excel export failed" });
  }
};