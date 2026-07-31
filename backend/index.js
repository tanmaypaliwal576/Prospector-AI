import express from "express";
import dotenv from "dotenv";
import cors from "cors";

import { connectDB } from "./config/db.js";

import leadsRoutes from "./routes/leads.js";
import analyticsRoutes from "./routes/analytics.js";
import userRoutes from "./routes/user.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

/* Middleware */
app.use(express.json());

const allowedOrigins = [
  "http://localhost:5173",
  "https://prospector-ai.netlify.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

/* Routes */
app.use("/api/leads", leadsRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/user", userRoutes);

/* Home Route */
app.get("/", (req, res) => {
  res.send("🚀 ProspectMiner AI Backend Running");
});

/* 404 Handler */
app.use((req, res) => {
  res.status(404).json({ message: "Route Not Found" });
});

/* Error Handler */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Internal Server Error" });
});

/* Start Server */
const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Database Connection Failed:", error.message);
    process.exit(1);
  }
};

startServer();