require("dotenv").config();
const http = require("http");
const { validateEnv } = require("./config/env");
const app = require("./app");
const { connectDB } = require("./config/db");
const { runOverdueCheck, startOverdueJob } = require("./jobs/overdueJob");
const { seedDemoData } = require("./services/seedService");
const { initializeSocket } = require("./services/socketService");

const env = validateEnv();
const port = env.PORT || 5000;
const server = http.createServer(app);
initializeSocket(server);

connectDB()
  .then(async () => {
    if (process.env.AUTO_SEED === "true" || global.__EMI_MEMORY_MONGO__) {
      await seedDemoData();
      console.log("Demo data ready");
    }
    startOverdueJob();
    runOverdueCheck().catch((error) => console.error("Initial notification check failed", error));
    server.listen(port, () => {
      console.log(`EMI Management API and Socket.IO running on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start server", error);
    process.exit(1);
  });
