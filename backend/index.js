import express from 'express';


const app = express();

app.get("/",(req,res)=>{
    res.send("Hey From Backend");
})

app.listen(3000 , ()=>{
    console.log("Server is Running!!")
})