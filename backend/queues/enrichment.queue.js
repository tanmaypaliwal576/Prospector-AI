import { Queue } from "bullmq";
import { redisConnection } from "../redis/redis.connection.js";

export const enrichmentQueue = new Queue("enrichmentQueue", {
  connection: redisConnection
});