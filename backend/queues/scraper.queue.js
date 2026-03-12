import { Queue } from "bullmq";
import { redisConnection } from "../redis/redis.connection.js";

export const scraperQueue = new Queue("scraperQueue", {
  connection: redisConnection
});