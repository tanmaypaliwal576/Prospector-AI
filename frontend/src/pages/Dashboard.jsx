import { useEffect, useState } from "react";
import { fetchLeads, fetchStats } from "../api/leadsApi";

import LeadsTable from "../components/LeadsTable";
import Filters from "../components/Filters";
import StatsCards from "../components/StatsCards";
import ExportButton from "../components/ExportButton";
import ScrapeForm from "../components/ScrapeForm";

const Dashboard = () => {
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState({});
  const [filters, setFilters] = useState({});
  const [pagination, setPagination] = useState({});

  const loadLeads = async () => {
    const res = await fetchLeads(filters);
    setLeads(res.data.leads);
    setPagination(res.data.pagination);
  };

  const loadStats = async () => {
    const res = await fetchStats();
    setStats(res.data.stats);
  };

  useEffect(() => {
    loadLeads();
    loadStats();
  }, [filters]);

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <h1 className="text-3xl font-bold mb-6">🚀 ProspectMiner AI</h1>

      <StatsCards stats={stats} />

      <div className="bg-white p-4 rounded-xl shadow mb-6">
        <ScrapeForm />
      </div>

      <div className="flex justify-between items-center mb-4">
        <Filters setFilters={setFilters} />
        <ExportButton />
      </div>

      <div className="bg-white p-4 rounded-xl shadow">
        <LeadsTable
          leads={leads}
          pagination={pagination}
          setFilters={setFilters}
        />
      </div>
    </div>
  );
};

export default Dashboard;