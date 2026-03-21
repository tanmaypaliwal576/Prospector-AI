import { useState, useEffect } from "react";

const Scraper = () => {
  const [query, setQuery] = useState("");
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [loading, setLoading] = useState(false);

  // 🔥 Start scraping
  const startScraping = async () => {
    if (!query) return alert("Enter a query");

    setLoading(true);
    setProgress({ done: 0, total: 0 });
    setJobId(null);

    try {
      const res = await fetch("http://localhost:5000/api/leads/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query })
      });

      const data = await res.json();

      if (data.success) {
        setJobId(data.jobId);
      } else {
        alert(data.message);
      }

    } catch (err) {
      console.log(err);
      alert("Error starting scraping");
    }

    setLoading(false);
  };

  // 🔥 Poll progress
  useEffect(() => {
    if (!jobId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `http://localhost:5000/api/leads/progress/${jobId}`
        );

        const data = await res.json();

        if (data.success) {
          setProgress({
            done: data.done,
            total: data.total
          });

          // ✅ stop polling when done
          if (data.done >= data.total && data.total !== 0) {
            clearInterval(interval);

            setTimeout(() => {
              alert("Scraping completed ✅");
            }, 500);
          }
        }

      } catch (err) {
        console.log("Progress error:", err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [jobId]);

  const percentage =
    progress.total > 0
      ? (progress.done / progress.total) * 100
      : 0;

  const isRunning =
    jobId && progress.done < progress.total;

  return (
    <div style={styles.container}>
      <h2>Prospecter AI Scraper</h2>

      {/* INPUT + BUTTON */}
      <div style={styles.row}>
        <input
          type="text"
          placeholder="e.g. hotels in indore"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={styles.input}
        />

        <button
          onClick={startScraping}
          disabled={isRunning || loading}
          style={{
            ...styles.button,
            opacity: isRunning ? 0.6 : 1
          }}
        >
          {loading
            ? "Starting..."
            : isRunning
            ? "Scraping..."
            : "Start Scraping"}
        </button>
      </div>

      {/* PROGRESS */}
      {jobId && (
        <div style={{ marginTop: "30px" }}>
          <p style={{ fontWeight: "bold" }}>
            Scraping {progress.done}/{progress.total}
          </p>

          <div style={styles.progressBar}>
            <div
              style={{
                ...styles.progressFill,
                width: `${percentage}%`
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

/* =========================
   STYLES
========================= */

const styles = {
  container: {
    padding: "40px",
    fontFamily: "Arial"
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "10px"
  },
  input: {
    padding: "10px",
    width: "300px",
    borderRadius: "5px",
    border: "1px solid #ccc"
  },
  button: {
    padding: "10px 20px",
    cursor: "pointer",
    borderRadius: "5px",
    border: "1px solid black"
  },
  progressBar: {
    width: "400px",
    height: "20px",
    background: "#ddd",
    borderRadius: "10px",
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    background: "green",
    transition: "0.3s"
  }
};

export default Scraper;