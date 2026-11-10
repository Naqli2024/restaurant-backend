import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { getRoles, initializeRoles } from "../controllers/roleController.js";

const router = express.Router();

// Get roles belonging to the authenticated restaurant.
router.get("/", authMiddleware, getRoles);

// Initialize missing default roles.
router.post(
  "/initialize-defaults",
  authMiddleware,
  initializeRoles
);

export default router;