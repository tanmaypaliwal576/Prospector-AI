import { Parser } from "json2csv";

export const exportToCSV = (leads) => {
  const fields = [
    "name",
    "website",
    "phone",
    "address",
    "rating",
    "services",
    "emailGuess",
    "leadQuality"
  ];

  const parser = new Parser({ fields });
  return parser.parse(leads);
};