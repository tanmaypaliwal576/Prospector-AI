import express from "express";
import leadRoutes from "./routes/leads.js";
import {connectDB} from './config/db.js'

const app = express();

app.use(express.json());


app.use("/api/leads", leadRoutes);

connectDB();

app.listen(5000 , ()=>{
    console.log("Server is Running!!")
})
export default app;