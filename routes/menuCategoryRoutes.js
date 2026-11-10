import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";

import {
  createMenuCategory,
  getMenuCategories,
  updateMenuCategory,
  updateMenuCategoryStatus,
} from "../controllers/menuCategoryController.js";

const router = express.Router();

router.use(authMiddleware);

router.post("/", createMenuCategory);

router.get("/", getMenuCategories);

router.put("/:id", updateMenuCategory);

router.patch("/:id/status", updateMenuCategoryStatus);

export default router;