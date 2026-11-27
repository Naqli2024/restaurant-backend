import express from "express";
import { createRestaurant, getRestaurantById } from "../controllers/restaurantController.js";

const router = express.Router();

// Public registration endpoint.
// Creates a restaurant and its first admin.
router.post("/register", createRestaurant);

// Get restaurant by ID
router.get("/:restaurantId", getRestaurantById);

export default router;