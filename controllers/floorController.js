import mongoose from "mongoose";
import Floor from "../models/Floor.js";
import Table from "../models/Table.js";

// POST /api/floors
// Create a floor and its tables.
export const createFloor = async (req, res) => {
  const { floorName, floorCode, description, displayOrder, tables } = req.body;

  // Only the restaurant administrator can configure floors.
  if (!["ADMIN", "BACKOFFICE"].includes(req.user?.roleCode)) {
    return res.status(403).json({
      success: false,
      message: "Only ADMIN or BACKOFFICE users can create floors.",
    });
  }

  // Always take the restaurant ID from the authenticated user.
  const restaurantId = req.user.restaurantId;

  // Validate required floor fields.
  if (
    typeof floorName !== "string" ||
    !floorName.trim() ||
    typeof floorCode !== "string" ||
    !floorCode.trim()
  ) {
    return res.status(400).json({
      success: false,
      message: "Floor name and floor code are required.",
    });
  }

  // At least one table is required when creating a floor.
  if (!Array.isArray(tables) || tables.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Add at least one table to the floor.",
    });
  }

  // Validate table names and seating capacities before writing to MongoDB.
  const normalizedTableNames = [];

  for (const table of tables) {
    if (typeof table.tableName !== "string" || !table.tableName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Every table must have a table name.",
      });
    }

    if (!Number.isInteger(table.seatingCapacity) || table.seatingCapacity < 1) {
      return res.status(400).json({
        success: false,
        message: `Invalid seating capacity for table ${table.tableName}.`,
      });
    }

    normalizedTableNames.push(table.tableName.trim().toLowerCase());
  }

  // Reject duplicate table names in the same request.
  if (new Set(normalizedTableNames).size !== normalizedTableNames.length) {
    return res.status(400).json({
      success: false,
      message: "Duplicate table names are not allowed within a floor.",
    });
  }

  // Validate optional ordering values.
  const finalDisplayOrder = displayOrder ?? 0;

  if (!Number.isInteger(finalDisplayOrder) || finalDisplayOrder < 0) {
    return res.status(400).json({
      success: false,
      message: "Display order must be a non-negative whole number.",
    });
  }

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      // Check for a floor with the same name in this restaurant.
      const existingFloor = await Floor.findOne({
        restaurantId,
        floorName: {
          $regex: `^${floorName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        },
      }).session(session);

      if (existingFloor) {
        const error = new Error("A floor with this name already exists.");
        error.statusCode = 409;
        throw error;
      }

      // Create the floor.
      const [floor] = await Floor.create(
        [
          {
            restaurantId,
            floorName: floorName.trim(),
            floorCode: floorCode.trim().toUpperCase(),
            description: description || "",
            displayOrder: finalDisplayOrder,
          },
        ],
        { session },
      );

      // Create all tables linked to this floor.
      const tableDocuments = tables.map((table, index) => ({
        restaurantId,
        floorId: floor._id,
        tableName: table.tableName.trim(),
        seatingCapacity: table.seatingCapacity,
        displayOrder: table.displayOrder ?? index,
      }));

      const createdTables = await Table.insertMany(tableDocuments, { session });

      result = {
        floor,
        tables: createdTables,
      };
    });

    return res.status(201).json({
      success: true,
      message: "Floor and tables created successfully.",
      data: result,
    });
  } catch (error) {
    console.error("Create floor error:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "A floor code or table name already exists in this restaurant or floor.",
      });
    }

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Failed to create floor and tables.",
    });
  } finally {
    await session.endSession();
  }
};

// GET /api/floors
// Retrieve all active floors and their active tables.
export const getFloors = async (req, res) => {
  try {
    // Get the restaurant ID from the authenticated user.
    const restaurantId = req.user.restaurantId;

    // Retrieve all active floors belonging to this restaurant.
    const floors = await Floor.find({
      restaurantId,
      isActive: true,
    })
      .sort({ displayOrder: 1, floorName: 1 })
      .lean();

    // Get the IDs of the retrieved floors.
    const floorIds = floors.map((floor) => floor._id);

    // Retrieve active tables belonging to these floors.
    const tables = floorIds.length
      ? await Table.find({
          restaurantId,
          floorId: { $in: floorIds },
          isActive: true,
        })
          .sort({ displayOrder: 1, tableName: 1 })
          .lean()
      : [];

    // Group tables under their respective floors.
    const tablesByFloor = new Map();

    for (const table of tables) {
      const floorId = table.floorId.toString();

      if (!tablesByFloor.has(floorId)) {
        tablesByFloor.set(floorId, []);
      }

      tablesByFloor.get(floorId).push(table);
    }

    // Return each floor with its tables.
    const result = floors.map((floor) => ({
      ...floor,
      tables: tablesByFloor.get(floor._id.toString()) || [],
    }));

    return res.status(200).json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (error) {
    console.error("Get floors error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve floors.",
    });
  }
};

// POST /api/floors/:floorId/tables
// Add a new table to an existing floor.
export const addTable = async (req, res) => {
  try {
    const { floorId } = req.params;
    const { tableName, seatingCapacity, displayOrder } = req.body;
    const restaurantId = req.user.restaurantId;

    if (!["ADMIN", "BACKOFFICE"].includes(req.user?.roleCode)) {
      return res.status(403).json({
        success: false,
        message: "Only ADMIN or BACKOFFICE users can add tables.",
      });
    }

    // Validate the floor ID.
    if (!mongoose.isValidObjectId(floorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid floor ID.",
      });
    }

    // Validate the table name.
    if (typeof tableName !== "string" || !tableName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Table name is required.",
      });
    }

    // Validate seating capacity.
    if (!Number.isInteger(seatingCapacity) || seatingCapacity < 1) {
      return res.status(400).json({
        success: false,
        message: "Seating capacity must be a positive whole number.",
      });
    }

    // Validate optional display order.
    const finalDisplayOrder = displayOrder ?? 0;

    if (!Number.isInteger(finalDisplayOrder) || finalDisplayOrder < 0) {
      return res.status(400).json({
        success: false,
        message: "Display order must be a non-negative whole number.",
      });
    }

    // Find the floor belonging to this restaurant.
    const floor = await Floor.findOne({
      _id: floorId,
      restaurantId,
      isActive: true,
    });

    if (!floor) {
      return res.status(404).json({
        success: false,
        message: "Active floor not found.",
      });
    }

    // Prevent duplicate table names within this floor.
    const existingTable = await Table.findOne({
      restaurantId,
      floorId,
      tableName: {
        $regex: `^${tableName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        $options: "i",
      },
    });

    if (existingTable) {
      return res.status(409).json({
        success: false,
        message: "A table with this name already exists in this floor.",
      });
    }

    // Create the table.
    const table = await Table.create({
      restaurantId,
      floorId: floor._id,
      tableName: tableName.trim(),
      seatingCapacity,
      displayOrder: finalDisplayOrder,
    });

    return res.status(201).json({
      success: true,
      message: "Table added successfully.",
      data: table,
    });
  } catch (error) {
    console.error("Add table error:", error);

    // Handles duplicate-key errors, including concurrent requests.
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A table with this name already exists in this floor.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to add table.",
    });
  }
};

// PUT /api/floors/:floorId
// Update an existing floor.
export const updateFloor = async (req, res) => {
  try {
    const { floorId } = req.params;
    const { floorName, floorCode, description, displayOrder } = req.body;
    const restaurantId = req.user.restaurantId;

    // Only the restaurant administrator can update floors.
    if (req.user.roleCode !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only the restaurant administrator can update floors.",
      });
    }

    // Validate floor ID.
    if (!mongoose.isValidObjectId(floorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid floor ID.",
      });
    }

    // Validate provided floor name.
    if (
      floorName !== undefined &&
      (typeof floorName !== "string" || !floorName.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Floor name cannot be empty.",
      });
    }

    // Validate provided floor code.
    if (
      floorCode !== undefined &&
      (typeof floorCode !== "string" || !floorCode.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Floor code cannot be empty.",
      });
    }

    // Validate display order.
    if (
      displayOrder !== undefined &&
      (!Number.isInteger(displayOrder) || displayOrder < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Display order must be a non-negative whole number.",
      });
    }

    // Find the active floor belonging to this restaurant.
    const floor = await Floor.findOne({
      _id: floorId,
      restaurantId,
      isActive: true,
    });

    if (!floor) {
      return res.status(404).json({
        success: false,
        message: "Active floor not found.",
      });
    }

    // Check whether another floor already uses the requested name.
    if (floorName !== undefined) {
      const existingFloor = await Floor.findOne({
        _id: { $ne: floorId },
        restaurantId,
        floorName: {
          $regex: `^${floorName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        },
      });

      if (existingFloor) {
        return res.status(409).json({
          success: false,
          message: "Another floor with this name already exists.",
        });
      }

      floor.floorName = floorName.trim();
    }

    // Check whether another floor uses the requested code.
    if (floorCode !== undefined) {
      const normalizedCode = floorCode.trim().toUpperCase();

      const existingFloor = await Floor.findOne({
        _id: { $ne: floorId },
        restaurantId,
        floorCode: normalizedCode,
      });

      if (existingFloor) {
        return res.status(409).json({
          success: false,
          message: "Another floor with this code already exists.",
        });
      }

      floor.floorCode = normalizedCode;
    }

    if (description !== undefined) {
      if (typeof description !== "string") {
        return res.status(400).json({
          success: false,
          message: "Description must be a string.",
        });
      }

      floor.description = description.trim();
    }

    if (displayOrder !== undefined) {
      floor.displayOrder = displayOrder;
    }

    await floor.save();

    return res.status(200).json({
      success: true,
      message: "Floor updated successfully.",
      data: floor,
    });
  } catch (error) {
    console.error("Update floor error:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "The floor code is already in use.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update floor.",
    });
  }
};

// PUT /api/floors/:floorId/tables/:tableId
// Update a table belonging to a floor.
export const updateTable = async (req, res) => {
  try {
    const { floorId, tableId } = req.params;
    const { tableName, seatingCapacity, displayOrder } = req.body;
    const restaurantId = req.user.restaurantId;

    // Only the restaurant administrator can update tables.
    if (req.user.roleCode !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only the restaurant administrator can update tables.",
      });
    }

    // Validate IDs.
    if (
      !mongoose.isValidObjectId(floorId) ||
      !mongoose.isValidObjectId(tableId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid floor ID or table ID.",
      });
    }

    // Validate table name.
    if (
      tableName !== undefined &&
      (typeof tableName !== "string" || !tableName.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Table name cannot be empty.",
      });
    }

    // Validate seating capacity.
    if (
      seatingCapacity !== undefined &&
      (!Number.isInteger(seatingCapacity) || seatingCapacity < 1)
    ) {
      return res.status(400).json({
        success: false,
        message: "Seating capacity must be a positive whole number.",
      });
    }

    // Validate display order.
    if (
      displayOrder !== undefined &&
      (!Number.isInteger(displayOrder) || displayOrder < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Display order must be a non-negative whole number.",
      });
    }

    // Ensure the floor belongs to this restaurant and is active.
    const floor = await Floor.findOne({
      _id: floorId,
      restaurantId,
      isActive: true,
    });

    if (!floor) {
      return res.status(404).json({
        success: false,
        message: "Active floor not found.",
      });
    }

    // Find the table under this floor and restaurant.
    const table = await Table.findOne({
      _id: tableId,
      restaurantId,
      floorId,
      isActive: true,
    });

    if (!table) {
      return res.status(404).json({
        success: false,
        message: "Active table not found in this floor.",
      });
    }

    // Prevent duplicate table names within the same floor.
    if (tableName !== undefined) {
      const normalizedName = tableName.trim();

      const existingTable = await Table.findOne({
        _id: { $ne: tableId },
        restaurantId,
        floorId,
        tableName: {
          $regex: `^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        },
      });

      if (existingTable) {
        return res.status(409).json({
          success: false,
          message: "Another table with this name already exists in this floor.",
        });
      }

      table.tableName = normalizedName;
    }

    if (seatingCapacity !== undefined) {
      table.seatingCapacity = seatingCapacity;
    }

    if (displayOrder !== undefined) {
      table.displayOrder = displayOrder;
    }

    await table.save();

    return res.status(200).json({
      success: true,
      message: "Table updated successfully.",
      data: table,
    });
  } catch (error) {
    console.error("Update table error:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A table with this name already exists in this floor.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update table.",
    });
  }
};

// PATCH /api/floors/:floorId/status
// Activate or deactivate a floor.
export const updateFloorStatus = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { floorId } = req.params;
    const { isActive } = req.body;
    const restaurantId = req.user.restaurantId;

    // Only the restaurant administrator can change floor status.
    if (req.user.roleCode !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only the restaurant administrator can change floor status.",
      });
    }

    if (!mongoose.isValidObjectId(floorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid floor ID.",
      });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be true or false.",
      });
    }

    let updatedFloor;

    await session.withTransaction(async () => {
      const floor = await Floor.findOne({
        _id: floorId,
        restaurantId,
      }).session(session);

      if (!floor) {
        const error = new Error("Floor not found.");
        error.statusCode = 404;
        throw error;
      }

      floor.isActive = isActive;
      await floor.save({ session });

      // When deactivating a floor, deactivate all its active tables.
      if (!isActive) {
        await Table.updateMany(
          {
            restaurantId,
            floorId: floor._id,
            isActive: true,
          },
          {
            $set: { isActive: false },
          },
          { session },
        );
      }

      updatedFloor = floor;
    });

    return res.status(200).json({
      success: true,
      message: isActive
        ? "Floor activated successfully."
        : "Floor deactivated successfully. Its tables have also been deactivated.",
      data: updatedFloor,
    });
  } catch (error) {
    console.error("Update floor status error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Failed to update floor status.",
    });
  } finally {
    await session.endSession();
  }
};

// PATCH /api/floors/:floorId/tables/:tableId/status
// Activate or deactivate a table.
export const updateTableStatus = async (req, res) => {
  try {
    const { floorId, tableId } = req.params;
    const { isActive } = req.body;
    const restaurantId = req.user.restaurantId;

    // Only the restaurant administrator can change table status.
    if (req.user.roleCode !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only the restaurant administrator can change table status.",
      });
    }

    if (
      !mongoose.isValidObjectId(floorId) ||
      !mongoose.isValidObjectId(tableId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid floor ID or table ID.",
      });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be true or false.",
      });
    }

    // Confirm that the floor belongs to this restaurant.
    const floor = await Floor.findOne({
      _id: floorId,
      restaurantId,
    });

    if (!floor) {
      return res.status(404).json({
        success: false,
        message: "Floor not found.",
      });
    }

    // Do not allow table activation while its floor is inactive.
    if (isActive && !floor.isActive) {
      return res.status(400).json({
        success: false,
        message: "Activate the floor before activating its tables.",
      });
    }

    // Find the table under this floor and restaurant.
    const table = await Table.findOne({
      _id: tableId,
      floorId,
      restaurantId,
    });

    if (!table) {
      return res.status(404).json({
        success: false,
        message: "Table not found in this floor.",
      });
    }

    table.isActive = isActive;
    await table.save();

    return res.status(200).json({
      success: true,
      message: isActive
        ? "Table activated successfully."
        : "Table deactivated successfully.",
      data: table,
    });
  } catch (error) {
    console.error("Update table status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update table status.",
    });
  }
};
