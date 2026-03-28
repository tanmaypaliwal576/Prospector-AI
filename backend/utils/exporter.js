import { Parser } from "json2csv";

export const exportToCSV = (leads) => {
  const fields = [
    "name",
    "website",
    "phone",
    "address",
    "rating",
    "reviews",
    "services",
    "businessType",
    "description",
    "ownerName",
    "emailGuess",
    "leadQuality"
  ];

  const normalized = leads.map((lead) => ({
    ...lead,
    services: Array.isArray(lead.services)
      ? lead.services.join(", ")
      : "",
    rating: lead.rating || "",
    reviews: lead.reviews || "",
    emailGuess: lead.emailGuess || "",
    description: lead.description || ""
  }));

  const parser = new Parser({ fields });
  return parser.parse(normalized);
};