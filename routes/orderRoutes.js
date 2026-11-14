import express from "express";

import {
  getDineInFloors,
  createDineInOrder,
  getOrderById,
  requestBill,
  getBillRequests,
  checkoutOrder,
  createTakeawayDeliveryOrder,
  updateFulfilmentStatus,
} from "../controllers/orderController.js";

import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// All order routes require authentication
router.use(authMiddleware);

// Get active floors and their tables
router.get("/dine-in/floors", getDineInFloors);
// Create a Dine-In order
router.post("/dine-in", createDineInOrder);
router.post("/takeaway-delivery", createTakeawayDeliveryOrder);

router.patch("/:orderId/fulfilment-status", updateFulfilmentStatus);

router.get("/bill-requests", getBillRequests);
// Captain requests bill for a specific order
router.patch("/:orderId/request-bill", requestBill);
router.patch("/:orderId/checkout", checkoutOrder);


// Get complete order details by Order ID
router.get("/:orderId", getOrderById);


export default router;