require("dotenv").config();
const { validateEnv } = require("./config/env");
const app = require("./app");
const { connectDB } = require("./config/db");
const { startOverdueJob } = require("./jobs/overdueJob");
const { seedDemoData } = require("./services/seedService");

const env = validateEnv();
const port = env.PORT || 5000;

connectDB()
  .then(async () => {
    if (process.env.AUTO_SEED === "true" || global.__EMI_MEMORY_MONGO__) {
      await seedDemoData();
      console.log("Demo data ready");
    }
    startOverdueJob();
    app.listen(port, () => {
      console.log(`EMI Management API running on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start server", error);
    process.exit(1);
  });
