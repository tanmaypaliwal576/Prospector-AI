import express from "express";
import dotenv from "dotenv";
import cors from "cors";

import leadsRoutes from "./routes/leads.js";
import analyticsRoutes from "./routes/analytics.js"; // ✅ ADD THIS

import { connectDB } from "./config/db.js";

dotenv.config();

const app = express();

/* =========================
   MIDDLEWARES
========================= */
app.use(express.json());
app.use(cors());

/* =========================
   ROUTES
========================= */
app.use("/api/leads", leadsRoutes);
app.use("/api/analytics", analyticsRoutes); // ✅ NEW

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.send("🚀 ProspectMiner AI Backend Running");
});

/* =========================
   404 HANDLER (OPTIONAL BUT GOOD)
========================= */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found"
  });
});

/* =========================
   GLOBAL ERROR HANDLER
========================= */
app.use((err, req, res, next) => {
  console.error("🔥 Server Error:", err.stack);

  res.status(500).json({
    success: false,
    message: "Internal Server Error"
  });
});

/* =========================
   SERVER START
========================= */
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB(); // ✅ Ensure DB connected first

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  }
};

startServer();