import dotenv from "dotenv";
import app from "./app.js";

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`License API local: http://localhost:${PORT}`);
  console.log(`Health:  GET  http://localhost:${PORT}/api/health`);
  console.log(`Verify:  POST http://localhost:${PORT}/api/license/verify`);
});
