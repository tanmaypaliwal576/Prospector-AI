import { Queue } from "bullmq";
import { redisConnection } from "../redis/redis.connection.js";

export const enrichmentQueue = new Queue("enrichmentQueue", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "fixed",
      delay: 24 * 60 * 60 * 1000 // 24h
    },
    removeOnComplete: true,
    removeOnFail: false
  }
});