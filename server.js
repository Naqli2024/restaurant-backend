import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";

import connectDB from "./config/db.js";
import restaurantRoutes from "./routes/restaurantRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import roleRoutes from "./routes/roleRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import floorRoutes from "./routes/floorRoutes.js";
import menuCategoryRoutes from "./routes/menuCategoryRoutes.js";
import foodMenuRoutes from "./routes/foodMenuRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import kitchenStationRoutes from "./routes/kitchenStationRoutes.js";
import kotRoutes from "./routes/kotRoutes.js";

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check API
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Restaurant Management API is running",
  });
});

// API health check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "API is healthy",
    environment: process.env.NODE_ENV,
  });
});

// Restaurant routes
app.use("/api/auth", authRoutes);
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/users", userRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/floors", floorRoutes);
app.use("/api/menu-categories", menuCategoryRoutes);
app.use("/api/food-menu", foodMenuRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/kitchen-stations", kitchenStationRoutes);
app.use("/api/kots", kotRoutes);

// Start server after connecting to MongoDB
const startServer = async () => {
  try {
    await connectDB();

    const PORT = process.env.PORT || 5000;

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
};

startServer();