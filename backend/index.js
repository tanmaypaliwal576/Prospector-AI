import express from "express";
import dotenv from "dotenv";
import cors from 'cors';
import leadsRoutes from "./routes/leads.js";

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());

// 🔥 MAIN ROUTE
app.use("/api/leads", leadsRoutes);

app.get("/", (req, res) => {
  res.send("Backend running");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});