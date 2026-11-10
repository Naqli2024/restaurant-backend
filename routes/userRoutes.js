import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { createEmployee } from "../controllers/userController.js";

const router = express.Router();

router.post("/create", authMiddleware, createEmployee);

export default router;