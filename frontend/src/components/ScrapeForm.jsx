import { useState } from "react";
import { startScrape } from "../api/leadsApi";

const ScrapeForm = () => {
  const [query, setQuery] = useState("");

  const handleSubmit = async () => {
    await startScrape(query);
    alert("Scraping started");
  };

  return (
    <div className="flex gap-2">
      <input
        className="border px-3 py-2 rounded w-full"
        placeholder="e.g. Hotels in Indore"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <button
        onClick={handleSubmit}
        className="bg-purple-600 text-white px-4 py-2 rounded"
      >
        Start
      </button>
    </div>
  );
};

export default ScrapeForm;