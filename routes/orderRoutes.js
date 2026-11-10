import express from "express";

import {
  getDineInFloors,
  createDineInOrder,
} from "../controllers/orderController.js";

import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// All order routes require authentication
router.use(authMiddleware);

// Get active floors and their tables
router.get("/dine-in/floors", getDineInFloors);

// Create a Dine-In order
router.post("/dine-in", createDineInOrder);

export default router;