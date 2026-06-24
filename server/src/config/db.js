const mongoose = require("mongoose");

async function connectDB(uri = process.env.MONGO_URI) {
  let finalUri = uri;
  if (!finalUri || process.env.USE_MEMORY_DB === "true") {
    const { MongoMemoryReplSet } = require("mongodb-memory-server");
    const memoryServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    finalUri = memoryServer.getUri();
    global.__EMI_MEMORY_MONGO__ = memoryServer;
    console.log("Using in-memory MongoDB for demo/development");
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(finalUri);
  return mongoose.connection;
}

module.exports = { connectDB };
