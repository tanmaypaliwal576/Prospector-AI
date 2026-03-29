import { useState } from "react";

const Filters = ({ setFilters }) => {
  const [quality, setQuality] = useState("");

  return (
    <div className="flex gap-2">
      <select
        className="border px-3 py-2 rounded"
        onChange={(e) => setQuality(e.target.value)}
      >
        <option value="">All</option>
        <option value="High">High</option>
        <option value="Medium">Medium</option>
        <option value="Low">Low</option>
      </select>

      <button
        className="bg-blue-500 text-white px-4 py-2 rounded"
        onClick={() => setFilters({ quality })}
      >
        Apply
      </button>
    </div>
  );
};

export default Filters;