import express from 'express';
import { connectDB } from './config/db.js';

const app = express();

app.get("/",(req,res)=>{
    res.send("Hey From Backend");
})

connectDB();
app.listen(3000 , ()=>{
    console.log("Server is Running!!")
})