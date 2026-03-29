import { exportCSV } from "../api/leadsApi";

const ExportButton = () => {
  return (
    <button
      onClick={exportCSV}
      className="bg-green-600 text-white px-4 py-2 rounded"
    >
      Export CSV
    </button>
  );
};

export default ExportButton;