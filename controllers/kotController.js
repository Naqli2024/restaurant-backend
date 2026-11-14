import mongoose from "mongoose";

import KOT from "../models/KOT.js";
import User from "../models/User.js";
import Employee from "../models/Employee.js";
import KitchenStation from "../models/KitchenStation.js";
import Floor from "../models/Floor.js";
import Table from "../models/Table.js";
import Order from "../models/Order.js";

// Common error response.
const handleError = (res, error, operation) => {
  console.error(`${operation} error:`, error);

  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "Something went wrong. Please try again.",
  });
};

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// Synchronize Takeaway/Delivery order status using all its KOTs.
const syncOrderFulfilmentStatus = async (orderId, restaurantId) => {
  const order = await Order.findOne({
    _id: orderId,
    restaurantId,
    orderType: { $in: ["Takeaway", "Delivery"] },
    orderStatus: "Active",
  });

  if (!order) return;

  const kots = await KOT.find({
    orderId,
    restaurantId,
  }).select("kotStatus");

  if (!kots.length) return;

  let nextStatus = "Pending";

  if (kots.every((kot) => kot.kotStatus === "Ready")) {
    nextStatus = "Ready";
  } else if (
    kots.some((kot) => ["Preparing", "Ready"].includes(kot.kotStatus))
  ) {
    nextStatus = "Preparing";
  }

  if (order.fulfilmentStatus !== nextStatus) {
    order.fulfilmentStatus = nextStatus;
    await order.save();
  }
};

// Only ADMIN and KITCHEN roles can access KOT APIs.
const getKOTAccess = async (req) => {
  const { restaurantId, userId, roleCode } = req.user;

  // ADMIN: Access all restaurant KOTs.
  if (roleCode === "ADMIN") {
    return {
      restaurantId,
      isAdmin: true,
      isCaptain: false,
      captainId: null,
      kitchenStationId: null,
    };
  }

  // CAPTAIN: Access only their own orders' KOTs.
  if (roleCode === "CAPTAIN") {
    return {
      restaurantId,
      isAdmin: false,
      isCaptain: true,
      captainId: userId,
      kitchenStationId: null,
    };
  }

  // Only KITCHEN can continue beyond this point.
  if (roleCode !== "KITCHEN") {
    throw createError("You are not authorized to access KOTs.", 403);
  }

  const user = await User.findOne({
    _id: userId,
    restaurantId,
    isActive: true,
  }).select("employeeId");

  if (!user || !user.employeeId) {
    throw createError("Kitchen employee account not found.", 403);
  }

  const employee = await Employee.findOne({
    _id: user.employeeId,
    userId: user._id,
    restaurantId,
    employmentStatus: "Active",
  }).select("kitchenStationId");

  if (!employee || !employee.kitchenStationId) {
    throw createError("No kitchen station is assigned to you.", 403);
  }

  const station = await KitchenStation.findOne({
    _id: employee.kitchenStationId,
    restaurantId,
    isActive: true,
  });

  if (!station) {
    throw createError("Your assigned kitchen station is inactive.", 403);
  }

  return {
    restaurantId,
    isAdmin: false,
    isCaptain: false,
    captainId: null,
    kitchenStationId: station._id,
  };
};

// GET /api/kots
export const getKOTs = async (req, res) => {
  try {
    const access = await getKOTAccess(req);

    const filter = {
      restaurantId: access.restaurantId,
    };

    // Kitchen employees can only see their assigned station's KOTs.
    if (access.isCaptain) {
      // Captain sees only their own Ready KOTs.
      filter.captainId = access.captainId;
      filter.kotStatus = "Ready";
    } else if (!access.isAdmin) {
      // Kitchen sees only their assigned station's KOTs.
      filter.kitchenStationId = access.kitchenStationId;
    }

    // Optional KOT status filter.
    if (req.query.status) {
      const allowedStatuses = [
        "New",
        "Preparing",
        "Ready",
        "Served",
        "Cancelled",
      ];

      if (!allowedStatuses.includes(req.query.status)) {
        throw createError("Invalid KOT status.");
      }

      // Captain cannot request other statuses.
      if (access.isCaptain && req.query.status !== "Ready") {
        throw createError("Captains can only view Ready KOTs.", 403);
      }

      filter.kotStatus = req.query.status;
    }

    // Admin can optionally filter by kitchen station.
    if (access.isAdmin && req.query.kitchenStationId) {
      if (!mongoose.isValidObjectId(req.query.kitchenStationId)) {
        throw createError("Invalid kitchen station ID.");
      }

      const station = await KitchenStation.findOne({
        _id: req.query.kitchenStationId,
        restaurantId: access.restaurantId,
      });

      if (!station) {
        throw createError("Kitchen station not found.", 404);
      }

      filter.kitchenStationId = station._id;
    }

    const kots = await KOT.find(filter).sort({
      createdAt: 1,
    });

    return res.status(200).json({
      success: true,
      count: kots.length,
      data: kots,
    });
  } catch (error) {
    return handleError(res, error, "Get KOTs");
  }
};

// GET /api/kots/:id
export const getKOTById = async (req, res) => {
  try {
    const access = await getKOTAccess(req);

    if (!mongoose.isValidObjectId(req.params.id)) {
      throw createError("Invalid KOT ID.");
    }

    const filter = {
      _id: req.params.id,
      restaurantId: access.restaurantId,
    };

    if (access.isCaptain) {
      filter.captainId = access.captainId;
    } else if (!access.isAdmin) {
      filter.kitchenStationId = access.kitchenStationId;
    }

    const kot = await KOT.findOne(filter);

    if (!kot) {
      throw createError("KOT not found.", 404);
    }

    return res.status(200).json({
      success: true,
      data: kot,
    });
  } catch (error) {
    return handleError(res, error, "Get KOT");
  }
};

// PATCH /api/kots/:id/start
export const startKOT = async (req, res) => {
  try {
    const access = await getKOTAccess(req);

    if (!mongoose.isValidObjectId(req.params.id)) {
      throw createError("Invalid KOT ID.");
    }

    const filter = {
      _id: req.params.id,
      restaurantId: access.restaurantId,
    };

    if (!access.isAdmin) {
      filter.kitchenStationId = access.kitchenStationId;
    }

    const kot = await KOT.findOne(filter);

    if (!kot) {
      throw createError("KOT not found.", 404);
    }

    if (["Ready", "Served", "Cancelled"].includes(kot.kotStatus)) {
      throw createError(
        `This KOT cannot be started because its status is ${kot.kotStatus}.`,
      );
    }

    // Start preparation for all new items.
    kot.items.forEach((item) => {
      if (item.itemStatus === "New") {
        item.itemStatus = "Preparing";
      }
    });

    kot.kotStatus = "Preparing";

    if (!kot.startedAt) {
      kot.startedAt = new Date();
    }

    await kot.save();

    await syncOrderFulfilmentStatus(kot.orderId, access.restaurantId);

    return res.status(200).json({
      success: true,
      message: "KOT preparation started.",
      data: kot,
    });
  } catch (error) {
    return handleError(res, error, "Start KOT");
  }
};

// PATCH /api/kots/:id/items/:itemId/status
export const updateKOTItemStatus = async (req, res) => {
  try {
    const access = await getKOTAccess(req);

    const { status } = req.body;
    const { id, itemId } = req.params;

    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(itemId)) {
      throw createError("Invalid KOT or item ID.");
    }

    // Captain can ONLY mark an item as Served.
    if (access.isCaptain && status !== "Served") {
      throw createError("Captains can only mark food items as Served.", 403);
    }

    // Kitchen and Admin can update preparation statuses.
    if (
      !access.isCaptain &&
      !["New", "Preparing", "Ready", "Cancelled"].includes(status)
    ) {
      throw createError("Invalid kitchen item status.");
    }

    const filter = {
      _id: id,
      restaurantId: access.restaurantId,
    };

    if (access.isCaptain) {
      filter.captainId = access.captainId;
    } else if (!access.isAdmin) {
      filter.kitchenStationId = access.kitchenStationId;
    }

    const kot = await KOT.findOne(filter);

    if (!kot) {
      throw createError("KOT not found.", 404);
    }

    if (["Served", "Cancelled"].includes(kot.kotStatus)) {
      throw createError(
        `Cannot update items because this KOT is ${kot.kotStatus}.`,
      );
    }

    const item = kot.items.id(itemId);

    if (!item) {
      throw createError("KOT item not found.", 404);
    }

    // Captain can serve only food that is Ready.
    if (access.isCaptain && item.itemStatus !== "Ready") {
      throw createError("Only Ready food items can be marked as Served.");
    }

    // Kitchen must start an item before marking it Ready.
    if (
      !access.isCaptain &&
      status === "Ready" &&
      !["Preparing", "Ready"].includes(item.itemStatus)
    ) {
      throw createError(
        "An item must be Preparing before it can be marked Ready.",
      );
    }

    item.itemStatus = status;

    const activeItems = kot.items.filter(
      (kotItem) => kotItem.itemStatus !== "Cancelled",
    );

    if (activeItems.length === 0) {
      kot.kotStatus = "Cancelled";
      kot.cancelledAt = new Date();
    } else if (
      activeItems.every((kotItem) => kotItem.itemStatus === "Served")
    ) {
      kot.kotStatus = "Served";
      kot.servedAt = new Date();
    } else if (
      activeItems.every((kotItem) =>
        ["Ready", "Served"].includes(kotItem.itemStatus),
      )
    ) {
      kot.kotStatus = "Ready";
    } else if (
      activeItems.some((kotItem) =>
        ["Preparing", "Ready", "Served"].includes(kotItem.itemStatus),
      )
    ) {
      kot.kotStatus = "Preparing";
    } else {
      kot.kotStatus = "New";
    }

    // Set readyAt when all active items become Ready or Served.
    if (kot.kotStatus === "Ready" && !kot.readyAt) {
      kot.readyAt = new Date();
    }

    // Clear readyAt if the KOT is no longer Ready.
    if (kot.kotStatus !== "Ready") {
      kot.readyAt = null;
    }

    if (["Preparing", "Ready"].includes(status) && !kot.startedAt) {
      kot.startedAt = new Date();
    }

    if (activeItems.some((kotItem) => kotItem.itemStatus !== "Served")) {
      kot.servedAt = null;
    }

    await kot.save();

    await syncOrderFulfilmentStatus(kot.orderId, access.restaurantId);

    return res.status(200).json({
      success: true,
      message: access.isCaptain
        ? "Food item marked as Served successfully."
        : "KOT item status updated successfully.",
      data: kot,
    });
  } catch (error) {
    return handleError(res, error, "Update KOT item status");
  }
};

// GET /api/kots/kitchen-display
export const getKitchenDisplay = async (req, res) => {
  try {
    const access = await getKOTAccess(req);

    // Kitchen Display is only for ADMIN and KITCHEN.
    if (access.isCaptain) {
      throw createError(
        "Captains are not authorized to access Kitchen Display.",
        403,
      );
    }

    const { restaurantId, isAdmin, kitchenStationId } = access;

    // 1. Get active kitchen stations.
    const stationFilter = {
      restaurantId,
      isActive: true,
    };

    // Kitchen employees can only access their assigned station.
    if (!isAdmin) {
      stationFilter._id = kitchenStationId;
    }

    const stations = await KitchenStation.find(stationFilter)
      .select("_id name code displayOrder")
      .sort({ displayOrder: 1, name: 1 })
      .lean();

    const stationIds = stations.map((station) => station._id);

    // 2. Get all active KOTs for accessible stations.
    const kotFilter = {
      restaurantId,
      kitchenStationId: { $in: stationIds },
      kotStatus: { $in: ["New", "Preparing", "Ready"] },
    };

    const allKots = await KOT.find(kotFilter).sort({ createdAt: 1 }).lean();

    // 3. Optional station filter for ADMIN.
    let displayKots = allKots;

    if (isAdmin && req.query.stationId) {
      if (!mongoose.isValidObjectId(req.query.stationId)) {
        throw createError("Invalid kitchen station ID.");
      }

      const selectedStation = stations.find(
        (station) => station._id.toString() === req.query.stationId,
      );

      if (!selectedStation) {
        throw createError("Kitchen station not found.", 404);
      }

      displayKots = allKots.filter(
        (kot) =>
          kot.kitchenStationId.toString() === selectedStation._id.toString(),
      );
    }

    // 4. Collect IDs needed to display additional information.
    const captainIds = [
      ...new Set(
        allKots
          .filter((kot) => kot.captainId)
          .map((kot) => kot.captainId.toString()),
      ),
    ];

    const tableIds = [
      ...new Set(
        allKots
          .filter((kot) => kot.tableId)
          .map((kot) => kot.tableId.toString()),
      ),
    ];

    const floorIds = [
      ...new Set(
        allKots
          .filter((kot) => kot.floorId)
          .map((kot) => kot.floorId.toString()),
      ),
    ];

    // 5. Retrieve Captain accounts.
    const captainUsers = await User.find({
      _id: { $in: captainIds },
      restaurantId,
    })
      .select("_id username employeeId")
      .lean();

    const employeeIds = captainUsers
      .filter((user) => user.employeeId)
      .map((user) => user.employeeId);

    const employees = await Employee.find({
      _id: { $in: employeeIds },
      restaurantId,
    })
      .select("_id employeeName")
      .lean();

    const employeeMap = new Map(
      employees.map((employee) => [
        employee._id.toString(),
        employee.employeeName,
      ]),
    );

    const captainMap = new Map(
      captainUsers.map((user) => [
        user._id.toString(),
        user.employeeId
          ? employeeMap.get(user.employeeId.toString()) || user.username
          : user.username,
      ]),
    );

    // 6. Retrieve table and floor information.
    const tables = await Table.find({
      _id: { $in: tableIds },
      restaurantId,
    })
      .select("_id tableName")
      .lean();

    const floors = await Floor.find({
      _id: { $in: floorIds },
      restaurantId,
    })
      .select("_id floorName")
      .lean();

    const tableMap = new Map(
      tables.map((table) => [table._id.toString(), table.tableName]),
    );

    const floorMap = new Map(
      floors.map((floor) => [floor._id.toString(), floor.floorName]),
    );

    // 7. Add display information to each KOT.
    const formattedKots = displayKots.map((kot) => ({
      ...kot,

      captainName: kot.captainId
        ? captainMap.get(kot.captainId.toString()) || "Unknown"
        : null,

      tableName: kot.tableId
        ? tableMap.get(kot.tableId.toString()) || "Unknown"
        : null,

      floorName: kot.floorId
        ? floorMap.get(kot.floorId.toString()) || "Unknown"
        : null,
    }));

    // 8. Group KOTs into the three Kitchen Display columns.
    const newKots = formattedKots.filter((kot) => kot.kotStatus === "New");

    const preparingKots = formattedKots.filter(
      (kot) => kot.kotStatus === "Preparing",
    );

    const readyKots = formattedKots.filter((kot) => kot.kotStatus === "Ready");

    // 9. Calculate station-wise active KOT counts.
    const stationsWithCounts = stations.map((station) => ({
      ...station,

      count: allKots.filter(
        (kot) => kot.kitchenStationId.toString() === station._id.toString(),
      ).length,
    }));

    // 10. Return Kitchen Display data.
    return res.status(200).json({
      success: true,

      summary: {
        new: newKots.length,
        preparing: preparingKots.length,
        ready: readyKots.length,
        total: formattedKots.length,
      },

      stations: stationsWithCounts,

      columns: {
        new: newKots,
        preparing: preparingKots,
        ready: readyKots,
      },
    });
  } catch (error) {
    return handleError(res, error, "Get Kitchen Display");
  }
};
