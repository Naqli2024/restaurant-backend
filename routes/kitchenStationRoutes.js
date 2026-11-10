import express from "express";

import {
  createKitchenStation,
  getKitchenStations,
} from "../controllers/kitchenStationController.js";

import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware);

router.post("/", createKitchenStation);

router.get("/", getKitchenStations);

export default router;