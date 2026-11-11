import "./mongo-host-dns.js";
import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "./logger.js";
import {
  attachMongoTopologyMonitor,
  logMongoTopologyIfChanged,
  markMongoShuttingDown,
} from "./mongo-topology.js";

mongoose.set("strictQuery", true);
mongoose.set("bufferCommands", false);

let connectionListenersBound = false;

const bindConnectionListeners = (): void => {
  if (connectionListenersBound) return;
  connectionListenersBound = true;
  mongoose.connection.on("error", (err: Error) => logger.error(`MongoDB connection error: ${err.message}`));
};

export const connectDatabase = async (): Promise<void> => {
  bindConnectionListeners();

  await mongoose.connect(env.mongoUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: env.mongoSelectTimeoutMs,
    retryWrites: true,
    bufferCommands: false,
    writeConcern: { w: "majority" },
    readPreference: "primaryPreferred",
  });

  attachMongoTopologyMonitor();
  logMongoTopologyIfChanged();
  logger.info(`MongoDB connected: ${mongoose.connection.name}`);
};

export const disconnectDatabase = async (): Promise<void> => {
  markMongoShuttingDown();
  await mongoose.disconnect();
  logger.info("mongoose closed (shutdown)");
};
