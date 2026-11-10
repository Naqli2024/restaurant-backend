import express from "express";
import { createRestaurant } from "../controllers/restaurantController.js";

const router = express.Router();

// Public registration endpoint.
// Creates a restaurant and its first admin.
router.post("/register", createRestaurant);

export default router;