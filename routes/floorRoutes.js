import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  createFloor,
  getFloors,
  addTable,
  updateFloor,
  updateTable,
  updateFloorStatus,
  updateTableStatus,
} from "../controllers/floorController.js";

const router = express.Router();

// All floor routes require authentication.
router.use(authMiddleware);

// Retrieve active floors and their tables.
router.get("/", getFloors);

// Create a floor with its tables.
router.post("/", createFloor);

// Add a table to an existing floor.
router.post("/:floorId/tables", addTable);

router.put("/:floorId", updateFloor);

router.put("/:floorId/tables/:tableId", updateTable);

// Activate or deactivate a floor.
router.patch("/:floorId/status", updateFloorStatus);

// Activate or deactivate a table.
router.patch(
  "/:floorId/tables/:tableId/status",
  updateTableStatus
);

export default router;
