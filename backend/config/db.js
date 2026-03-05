import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

export const connectDB = async()=> {
    try {   
    await mongoose.connect(process.env.MONGO_URI)
    console.log("DataBase Connected!")
} catch (error) {
    console.log("Mongo DB Error: " ,error)
    process.exit(1);
}
}

