import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Download, Zap, AlertCircle, RefreshCw } from "lucide-react";

export default function Dashboard() {
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState({});
  const [query, setQuery] = useState("");
  const [credits, setCredits] = useState(null);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [qualityFilter, setQualityFilter] = useState("");

  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [loading, setLoading] = useState(false);

  const [selectedLead, setSelectedLead] = useState(null);

  /* ================= LOAD ================= */

  useEffect(() => {
    loadAll();
  }, [page, qualityFilter]);

  const loadAll = async () => {
    try {
      const [leadsRes, statsRes, creditsRes] = await Promise.all([
        fetch(`/api/leads?page=${page}&limit=10${qualityFilter ? `&quality=${qualityFilter}` : ''}`),
        fetch("/api/leads/stats"),
        fetch("/api/user/credits")
      ]);

      const leadsData = await leadsRes.json();
      const statsData = await statsRes.json();
      const creditsData = await creditsRes.json();

      if (leadsData.success) {
        setLeads(leadsData.leads);
        setTotalPages(leadsData.pagination.pages);
      }
      if (statsData.success) setStats(statsData.stats);
      if (creditsData.success) setCredits(creditsData.credits);
    } catch (e) {
      console.error("Load all error: ", e);
    }
  };

  /* ================= POLLING ================= */

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const creditsRes = await fetch("/api/user/credits");
        const creditsData = await creditsRes.json();
        if (creditsData.success) setCredits(creditsData.credits);
      } catch (e) { /* silent */ }
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  /* ================= SCRAPER ================= */

  const startScraping = async () => {
    if (!query) return;
    setLoading(true);
    setProgress({ done: 0, total: 0 });
    const res = await fetch("/api/leads/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });

    const data = await res.json();
    setLoading(false);
    if (data.success) {
      setJobId(data.jobId);
    } else {
      alert(data.message);
    }
  };

  /* ================= EXPORT ================= */

  const handleExportCSV = async () => {
    window.location.href = "/api/leads/export/csv";
  };

  const handleExportExcel = async () => {
    window.location.href = "/api/leads/export/excel";
  };

  /* ================= PROGRESS ================= */

  useEffect(() => {
    if (!jobId) return;

    const interval = setInterval(async () => {
      const res = await fetch(`/api/leads/progress/${jobId}`);
      const data = await res.json();

      if (data.success) {
        setProgress(data);

        // Completion logic
        if (data.phase === "completed") {
          clearInterval(interval);
          setJobId(null);
          loadAll(); // Refresh table when done
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [jobId]);

  const percent = progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  /* ================= ANIMATION VARIANTS ================= */
  const containerVars = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };
  const itemVars = {
    hidden: { y: 20, opacity: 0 },
    show: { y: 0, opacity: 1, transition: { type: "spring", stiffness: 300, damping: 24 } }
  };

  return (
    <div className="min-h-screen text-white overflow-hidden relative selection:bg-indigo-500/30 bg-black">
  
      {/* Background glow */}
      <div className="absolute -top-40 left-0 md:left-60 md:-top-20 w-[600px] h-[600px] bg-white opacity-10 blur-3xl rounded-full pointer-events-none"></div>

      <div className="max-w-6xl mx-auto px-6 py-10 relative z-10">

        {/* HEADER */}
        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex justify-between items-center mb-10 pb-6 border-b border-white/10">
        <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-300 to-gray-100">
  ProspectMiner AI
</h1>

         <div className={`flex items-center gap-2 font-bold ${
  credits === null
    ? 'text-gray-400'
    : credits > 0
    ? 'text-emerald-400'
    : 'text-red-400 animate-pulse'
}`}>
   🪙 {credits === null ? "--" : credits}
</div>
        </motion.div>

        <motion.div variants={containerVars} initial="hidden" animate="show">

          {/* ZERO CREDITS WARNING */}
          <AnimatePresence>
            {credits === 0 && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }} 
                animate={{ opacity: 1, height: 'auto' }} 
                exit={{ opacity: 0, height: 0 }}
                className="mb-8"
              >
                <div className="glass !bg-red-500/10 !border-red-500/30 p-6 rounded-2xl flex items-start gap-4 shadow-[0_0_30px_rgba(239,68,68,0.15)]">
                  <AlertCircle className="text-red-400 w-8 h-8 shrink-0" />
                  <div>
                    <h3 className="text-red-400 font-bold text-lg">Credits Depleted</h3>
                    <p className="text-red-200/70 text-sm mt-1">You have exhausted your credits. The scraper will no longer extract leads. Please recharge your balance to continue.</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* SEARCH BOX */}
          <motion.div variants={itemVars} className={`glass p-3 flex items-center gap-3 mb-8 rounded-2xl transition-all duration-300 ${jobId ? 'ring-2 ring-indigo-500/50 scale-[0.99] opacity-70 pointer-events-none' : 'focus-within:ring-2 focus-within:ring-purple-500/50'}`}>
            <Search className="text-gray-400 ml-3" size={20} />
            
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={credits <= 0 || jobId}
              placeholder="E.g. Healthcare clinics in Manhattan..."
              className="bg-transparent outline-none flex-1 text-base placeholder-gray-500 px-2 h-12 text-white"
            />

            <button
              onClick={startScraping}
              disabled={credits <= 0 || !query || loading}
              className="btn-primary flex items-center gap-2 h-12 px-6 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <RefreshCw className="animate-spin" size={18} /> : (jobId ? <Zap className="animate-pulse text-indigo-500" size={18} /> : <Zap size={18} />)}
              {jobId ? "Extracting..." : "Launch Scraper"}
            </button>
          </motion.div>

          {/* PROGRESS INDICATOR */}
          <AnimatePresence>
            {jobId && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }} 
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="mb-8 p-6 glass rounded-2xl relative overflow-hidden"
              >
                <div className="flex justify-between items-center mb-3 text-sm font-medium">
                  <div className="flex items-center gap-2 text-indigo-300">
                     <RefreshCw size={16} className="animate-spin" />
                     {progress.phase === "enriching" 
                        ? "AI Extraction & Finalizing Insights..." 
                        : "Scanning Area & Analyzing Maps..."}
                  </div>
                  {progress.phase !== "enriching" && (
                    <div className="text-gray-300 font-mono">
                      {progress.done} / {progress.total}
                    </div>
                  )}
                </div>

                <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/5 relative">
                  <motion.div
                    className="absolute top-0 left-0 bottom-0 bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 bg-[length:200%_auto] animate-[animatedgradient_2s_linear_infinite]"
                    initial={{ width: 0 }}
                    animate={{ width: progress.phase === "enriching" ? "100%" : `${percent}%` }}
                    transition={{ ease: "easeOut", duration: 0.5 }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* STATS */}
          <motion.div variants={itemVars} className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Card title="Total Leads" value={stats.total} icon="📊" />
            <Card title="High Quality" value={stats.High} icon="🔥" color="text-emerald-400" />
            <Card title="Medium Quality" value={stats.Medium} icon="⭐" color="text-yellow-400" />
            <Card title="Low Quality" value={stats.Low} icon="🤷" color="text-gray-400" />
          </motion.div>

          {/* TABLE HEADER ACTIONS */}
          <motion.div variants={itemVars} className="flex flex-wrap md:flex-nowrap justify-between gap-4 mb-4">
            <div className="flex w-full md:w-auto gap-4">
              <div className="glass px-4 h-11 flex items-center rounded-xl text-sm w-full md:w-auto">
                 <Search size={16} className="text-gray-500 mr-2" />
                 <input placeholder="Filter leads..." className="bg-transparent outline-none w-full" />
              </div>
              
              <select 
                value={qualityFilter} 
                onChange={e => { setQualityFilter(e.target.value); setPage(1); }}
                className="glass px-4 h-11 rounded-xl text-sm outline-none bg-white text-white cursor-pointer shadow-lg"
              >
                 <option value="" className="text-black">All Qualities</option>
                 <option value="High" className="text-black">High Quality</option>
                 <option value="Medium" className="text-black">Medium Quality</option>
                 <option value="Low" className="text-black">Low Quality</option>
              </select>
            </div>

            <div className="flex gap-2 w-full md:w-auto">
              <button
                onClick={handleExportCSV}
                className="glass px-5 h-11 flex items-center justify-center gap-2 rounded-xl text-sm hover:bg-white/10 transition-colors font-medium border border-indigo-500/30 text-indigo-100 shadow-[0_0_15px_rgba(99,102,241,0.1)] w-full md:w-auto whitespace-nowrap"
              >
                <Download size={16} /> Export CSV
              </button>
              <button
                onClick={handleExportExcel}
                className="glass px-5 h-11 flex items-center justify-center gap-2 rounded-xl text-sm hover:bg-white/10 transition-colors font-medium border border-[#3e8b5d]/50 text-[#8effba] shadow-[0_0_15px_rgba(62,139,93,0.15)] w-full md:w-auto whitespace-nowrap"
              >
                <Download size={16} /> Export Excel
              </button>
            </div>
          </motion.div>

          {/* TABLE */}
          <motion.div variants={itemVars} className="glass rounded-2xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-white/5 border-b border-white/10">
                  <tr>
                    <th className="p-4 font-semibold text-gray-300">Name</th>
                    <th className="p-4 font-semibold text-gray-300">Website</th>
                    <th className="p-4 font-semibold text-gray-300">Phone</th>
                    <th className="p-4 font-semibold text-gray-300">Services & Details</th>
                    <th className="p-4 font-semibold text-gray-300">Type</th>
                    <th className="p-4 font-semibold text-gray-300">Quality</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-white/5">
                  <AnimatePresence>
                    {leads.map((lead, idx) => (
                      <motion.tr
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        key={lead._id}
                        className="hover:bg-white-[0.02] transition-colors group"
                      >
                        <td className="p-4 font-medium">{lead.name}</td>
                        <td className="p-4">
                           {lead.website ? (
                             <a href={lead.website} target="_blank" rel="noreferrer" className="text-indigo-400 hover:text-indigo-300 underline-offset-4 hover:underline truncate max-w-[150px] inline-block">
                               {lead.website.replace(/^https?:\/\//, '')}
                             </a>
                           ) : <span className="text-gray-600">-</span>}
                        </td>
                        <td className="p-4 text-gray-300">{lead.phone ? lead.phone.replace(/[^\d\+\-\s\(\)]/g, "") : '-'}</td>
                        <td className="p-4 text-gray-400">
                          <div className="flex items-center gap-2">
                            <div className="truncate max-w-[150px]">
                              {(lead.services || []).join(", ") || lead.description || '-'}
                            </div>
                            {(lead.description || (lead.services && lead.services.length > 0)) && (
                              <button 
                                onClick={() => setSelectedLead(lead)}
                                className="p-1 hover:bg-white/10 rounded-md transition-colors text-indigo-400"
                                title="View Details"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-gray-400 capitalize">{lead.businessType || '-'}</td>
                        <td className="p-4">
                          <Badge q={lead.leadQuality} />
                        </td>
                      </motion.tr>
                    ))}
                    {leads.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-12 text-center text-gray-500">
                          No leads available. Start a scrape to fill this table.
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
            
            {/* PAGINATION */}
            <div className="bg-black/20 p-4 border-t border-white/5 flex justify-between items-center text-sm">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="glass px-5 py-2 rounded-lg disabled:opacity-30 hover:bg-white/10 transition-colors"
              >
                Previous
              </button>
              <div className="text-gray-400 font-mono">
                <span className="text-white">{page}</span> / {totalPages || 1}
              </div>
              <button
                disabled={page === totalPages || totalPages === 0}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="glass px-5 py-2 rounded-lg disabled:opacity-30 hover:bg-white/10 transition-colors"
              >
                Next
              </button>
            </div>
          </motion.div>

        </motion.div>
      </div>

      {/* LEAD DETAILS MODAL */}
      <AnimatePresence>
        {selectedLead && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedLead(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="glass p-8 rounded-2xl max-w-lg w-full shadow-2xl border border-white/10 bg-[#0a0a0a]/90"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-white">{selectedLead.name}</h2>
                  <p className="text-indigo-400 text-sm mt-1">{selectedLead.businessType}</p>
                </div>
                <button onClick={() => setSelectedLead(null)} className="text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 p-2 rounded-full transition-colors">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>

              <div className="space-y-4">
                {selectedLead.description && (
                  <div>
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Description</h3>
                    <p className="text-gray-300 text-sm leading-relaxed bg-white/5 p-4 rounded-xl border border-white/5">{selectedLead.description}</p>
                  </div>
                )}
                
                {selectedLead.services && selectedLead.services.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Services Provided</h3>
                    <div className="flex flex-wrap gap-2">
                       {selectedLead.services.map((svc, i) => (
                         <span key={i} className="px-3 py-1.5 bg-indigo-500/10 text-indigo-300 rounded-lg text-xs border border-indigo-500/20">{svc}</span>
                       ))}
                    </div>
                  </div>
                )}

                {selectedLead.address && (
                  <div>
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 mt-2">Address</h3>
                    <p className="text-gray-300 text-sm">{selectedLead.address}</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
    
  );
}

/* COMPONENTS */
function Card({ title, value, icon, color = "text-white" }) {
  return (
    <div className="glass p-5 rounded-2xl flex items-center justify-between hover:scale-[1.02] transition-transform duration-300">
      <div>
        <p className="text-gray-400 text-xs font-semibold tracking-wider uppercase mb-1">{title}</p>
        <h2 className={`text-2xl font-bold ${color}`}>
          {value || 0}
        </h2>
      </div>
      <div className="text-2xl opacity-80">{icon}</div>
    </div>
  );
}

function Badge({ q }) {
  const styles =
    q === "High" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      : q === "Medium" ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
      : q === "Low" ? "bg-red-500/10 text-red-400 border-red-500/20"
      : "bg-gray-500/10 text-gray-400 border-gray-500/20";

  return (
    <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${styles}`}>
      {q || "None"}
    </span>
  );
}