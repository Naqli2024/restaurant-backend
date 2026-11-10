import express from "express";
import { login, logout, getLoggedInUser } from "../controllers/authController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// Login
router.post("/login", login);

// Logout
router.post("/logout", authMiddleware, logout);

// Get logged-in user details
router.get("/me", authMiddleware, getLoggedInUser);

export default router;