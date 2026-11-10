
import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";
import requirePermission from "../middleware/requirePermission.js";

import {
  addEmployee,
  editEmployee,
  listEmployees,
  getEmployee,
  changeOnboardingStatus,
  changeEmploymentStatus,
} from "../controllers/employeeController.js";

const router = express.Router();

// All employee routes require authentication.
router.use(authMiddleware);

// Create employee.
router.post(
  "/",
  requirePermission("employees", "create"),
  addEmployee
);

// List employees.
router.get(
  "/",
  requirePermission("employees", "read"),
  listEmployees
);

// Update employee information.
router.put(
  "/:id",
  requirePermission("employees", "update"),
  editEmployee
);

// Update onboarding status.
router.patch(
  "/:id/onboarding",
  requirePermission("employees", "update"),
  changeOnboardingStatus
);

// Update employment status.
router.patch(
  "/:id/status",
  requirePermission("employees", "update"),
  changeEmploymentStatus
);

// Get employee details.
// Keep this after the specific routes.
router.get(
  "/:id",
  requirePermission("employees", "read"),
  getEmployee
);

export default router;
