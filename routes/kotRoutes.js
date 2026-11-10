import express from "express";

import {
  getKOTs,
  getKOTById,
  startKOT,
  updateKOTItemStatus,
} from "../controllers/kotController.js";

import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// All KOT routes require authentication.
router.use(authMiddleware);

// Get all KOTs (ADMIN) or assigned station KOTs (KITCHEN).
router.get("/", getKOTs);

// Get one KOT.
router.get("/:id", getKOTById);

// Start KOT preparation.
router.patch("/:id/start", startKOT);

// Update individual KOT item status.
router.patch("/:id/items/:itemId/status", updateKOTItemStatus);

export default router;