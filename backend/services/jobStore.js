class JobStore {
  constructor() {
    this.jobs = new Map();
  }

  createJob() {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.jobs.set(jobId, {
      scrapeTotal: 0,
      scrapeDone: 0,
      enrichTotal: 0,
      enrichDone: 0,
      phase: "starting",
      createdAt: Date.now()
    });
    this.cleanupOldJobs();
    return jobId;
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  setScrapeTotal(jobId, total) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.scrapeTotal = total;
    if (total > 0) job.phase = "scraping";
  }

  incScrapeDone(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.scrapeDone += 1;
  }

  incEnrichTotal(jobId, count = 1) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.enrichTotal += count;
  }

  incEnrichDone(jobId, count = 1) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.enrichDone += count;
  }

  setPhase(jobId, phase) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.phase = phase;
  }

  setError(jobId, message) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.phase = "failed";
    job.error = message;
  }

  getProgress(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      // jobId not found: either it never existed, or the server process
      // restarted (e.g. Render ran out of memory) and lost in-memory state.
      // Report this explicitly instead of pretending the job is "starting"
      // forever, so the frontend can stop polling and tell the user.
      return { success: true, phase: "unknown", total: 0, done: 0 };
    }

    const { scrapeTotal, scrapeDone, enrichTotal, enrichDone, phase, error } = job;

    if (phase === "failed") {
      return {
        success: true,
        phase: "failed",
        total: enrichTotal || scrapeTotal,
        done: enrichDone || scrapeDone,
        error: error || "Job failed"
      };
    }

    if (phase === "completed") {
      return {
        success: true,
        phase: "completed",
        total: enrichTotal || scrapeTotal,
        done: enrichDone || scrapeDone
      };
    }

    if (scrapeTotal > 0 && scrapeDone < scrapeTotal) {
      return { success: true, phase: "scraping", total: scrapeTotal, done: scrapeDone };
    }

    if (enrichTotal > 0 && enrichDone < enrichTotal) {
      return { success: true, phase: "enriching", total: enrichTotal, done: enrichDone };
    }

    if (scrapeTotal > 0 && scrapeDone >= scrapeTotal) {
      return {
        success: true,
        phase: "completed",
        total: enrichTotal || scrapeTotal,
        done: enrichDone || scrapeDone
      };
    }

    return { success: true, phase, total: 0, done: 0 };
  }

  cleanupOldJobs() {
    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();
    for (const [id, job] of this.jobs.entries()) {
      if (now - job.createdAt > ONE_HOUR) {
        this.jobs.delete(id);
      }
    }
  }
}

export const jobStore = new JobStore();
