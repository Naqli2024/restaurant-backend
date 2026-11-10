import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";

import {
  createFoodMenu,
  getFoodMenus,
  updateFoodMenu,
  updateFoodMenuStatus,
  updateFoodMenuAvailability,
} from "../controllers/foodMenuController.js";

const router = express.Router();

router.use(authMiddleware);

router.post("/", createFoodMenu);

router.get("/", getFoodMenus);

router.put("/:id", updateFoodMenu);

router.patch("/:id/status", updateFoodMenuStatus);

router.patch("/:id/availability", updateFoodMenuAvailability);

export default router;