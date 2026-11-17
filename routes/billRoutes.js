import express from "express";
import { generateBill, collectPayment, getCashierPerformanceDashboard, } from "../controllers/billController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware);

router.get(
  "/cashier/performance",
  getCashierPerformanceDashboard
);

router.post("/:orderId/generate", generateBill);
router.patch("/:billId/collect-payment", collectPayment);

export default router;