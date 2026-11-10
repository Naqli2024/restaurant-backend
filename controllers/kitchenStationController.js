import mongoose from "mongoose";
import KitchenStation from "../models/KitchenStation.js";

// =====================================================
// 1. CREATE KITCHEN STATION
// =====================================================

export const createKitchenStation = async (req, res) => {
  try {
    // Only ADMIN can create kitchen stations
    if (req.user.roleCode !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only restaurant administrators can create kitchen stations.",
      });
    }

    const restaurantId = req.user.restaurantId;

    const {
      name,
      code,
      description,
      displayOrder,
    } = req.body;

    // ---------------------------------------------
    // Basic validation
    // ---------------------------------------------

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Kitchen station name is required.",
      });
    }

    if (!code || typeof code !== "string" || !code.trim()) {
      return res.status(400).json({
        success: false,
        message: "Kitchen station code is required.",
      });
    }

    if (
      description !== undefined &&
      typeof description !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Description must be text.",
      });
    }

    if (
      displayOrder !== undefined &&
      (!Number.isInteger(Number(displayOrder)) ||
        Number(displayOrder) < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Display order must be a non-negative whole number.",
      });
    }

    const stationName = name.trim();
    const stationCode = code.trim().toUpperCase();

    // ---------------------------------------------
    // Check duplicate station name or code
    // ---------------------------------------------

    const existingStation = await KitchenStation.findOne({
      restaurantId,
      $or: [
        { name: stationName },
        { code: stationCode },
      ],
    }).collation({ locale: "en", strength: 2 });

    if (existingStation) {
      return res.status(409).json({
        success: false,
        message: "A kitchen station with this name or code already exists.",
      });
    }

    // ---------------------------------------------
    // Create kitchen station
    // ---------------------------------------------

    const kitchenStation = await KitchenStation.create({
      restaurantId,
      name: stationName,
      code: stationCode,
      description: description?.trim() || "",
      displayOrder:
        displayOrder !== undefined ? Number(displayOrder) : 0,
    });

    return res.status(201).json({
      success: true,
      message: "Kitchen station created successfully.",
      data: kitchenStation,
    });

  } catch (error) {
    console.error("Create Kitchen Station Error:", error);

    // Handle duplicate index errors
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Kitchen station name or code already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create kitchen station.",
    });
  }
};


// =====================================================
// 2. GET KITCHEN STATIONS
// =====================================================

export const getKitchenStations = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;

    // Admin can see all stations, including inactive ones.
    // Other employees see only active stations.
    const filter = {
      restaurantId,
    };

    if (req.user.roleCode !== "ADMIN") {
      filter.isActive = true;
    }

    const kitchenStations = await KitchenStation.find(filter)
      .sort({ displayOrder: 1, name: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Kitchen stations fetched successfully.",
      count: kitchenStations.length,
      data: kitchenStations,
    });

  } catch (error) {
    console.error("Get Kitchen Stations Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch kitchen stations.",
    });
  }
};