import mongoose from "mongoose";

import Floor from "../models/Floor.js";
import Table from "../models/Table.js";
import FoodMenu from "../models/FoodMenu.js";
import Order from "../models/Order.js";
import KitchenStation from "../models/KitchenStation.js";
import KOT from "../models/KOT.js";
import User from "../models/User.js";
import Role from "../models/Role.js";

// Helper: round amounts to 2 decimal places
const roundMoney = (amount) => {
  return Math.round(amount);
};

// Helper: allow only ADMIN and CAPTAIN to create Dine-In orders
const canCreateOrder = (req) => {
  return ["ADMIN", "CAPTAIN"].includes(req.user?.roleCode);
};

// =====================================================
// 1. GET ACTIVE FLOORS AND TABLES FOR DINE-IN ORDER
// =====================================================

export const getDineInFloors = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;

    // 1. Get active floors
    const floors = await Floor.find({
      restaurantId,
      isActive: true,
    })
      .sort({ displayOrder: 1, floorName: 1 })
      .lean();

    if (!floors.length) {
      return res.status(200).json({
        success: true,
        message: "No active floors found.",
        data: [],
      });
    }

    const floorIds = floors.map((floor) => floor._id);

    // 2. Get active tables
    const tables = await Table.find({
      restaurantId,
      floorId: { $in: floorIds },
      isActive: true,
    })
      .sort({ displayOrder: 1, tableName: 1 })
      .lean();

    const tableIds = tables.map((table) => table._id);

    // 3. Get orders for groups still seated at these tables
    const activeOrders = await Order.find({
      restaurantId,
      tableId: { $in: tableIds },
      seatingStatus: "Seated",
      orderStatus: { $ne: "Cancelled" },
    })
      .select(
        "_id tableId customerName numberOfGuests orderStatus paymentStatus",
      )
      .lean();

    // 4. Group orders by table
    const ordersByTable = new Map();

    for (const order of activeOrders) {
      const key = order.tableId.toString();

      if (!ordersByTable.has(key)) {
        ordersByTable.set(key, []);
      }

      ordersByTable.get(key).push(order);
    }

    // 5. Attach tables to floors
    const floorsWithTables = floors.map((floor) => ({
      ...floor,

      tables: tables
        .filter((table) => table.floorId.toString() === floor._id.toString())
        .map((table) => {
          const occupiedSeats = table.occupiedSeats || 0;

          const availableSeats = Math.max(
            table.seatingCapacity - occupiedSeats,
            0,
          );

          const occupancyStatus =
            occupiedSeats === 0
              ? "Available"
              : occupiedSeats >= table.seatingCapacity
                ? "Fully Occupied"
                : "Partially Occupied";

          return {
            _id: table._id,
            tableName: table.tableName,
            seatingCapacity: table.seatingCapacity,
            displayOrder: table.displayOrder,

            occupiedSeats,
            availableSeats,
            occupancyStatus,

            currentOrders: ordersByTable.get(table._id.toString()) || [],
          };
        }),
    }));

    return res.status(200).json({
      success: true,
      message: "Floors and tables fetched successfully.",
      data: floorsWithTables,
    });
  } catch (error) {
    console.error("Get Dine-In Floors Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch floors and tables.",
    });
  }
};

// =====================================================
// 2. CREATE DINE-IN ORDER
// =====================================================

export const createDineInOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    // 1. Only ADMIN and CAPTAIN can create Dine-In orders
    if (!canCreateOrder(req)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to create orders.",
      });
    }

    const restaurantId = req.user.restaurantId;
    const loggedInUserId = req.user.userId;
    const roleCode = req.user.roleCode;

    // ADMIN must select a Captain.
    // CAPTAIN automatically becomes the assigned Captain.
    let captainId = null;

    if (roleCode === "CAPTAIN") {
      captainId = loggedInUserId;
    } else if (roleCode === "ADMIN") {
      captainId = req.body.captainId;

      if (!captainId || !mongoose.isValidObjectId(captainId)) {
        return res.status(400).json({
          success: false,
          message: "Please select a valid Captain for this order.",
        });
      }
    }

    const { floorId, tableId, customerName, numberOfGuests, items } = req.body;

    // ---------------------------------------------
    // 2. Basic validation
    // ---------------------------------------------

    if (!floorId || !mongoose.isValidObjectId(floorId)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid floor.",
      });
    }

    if (!tableId || !mongoose.isValidObjectId(tableId)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid table.",
      });
    }

    if (
      !customerName ||
      typeof customerName !== "string" ||
      !customerName.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Customer name is required.",
      });
    }

    if (
      !Number.isInteger(Number(numberOfGuests)) ||
      Number(numberOfGuests) < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Number of guests must be a whole number greater than zero.",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please add at least one food item.",
      });
    }

    const guests = Number(numberOfGuests);

    // Validate food items
    for (const item of items) {
      if (!item.foodMenuId || !mongoose.isValidObjectId(item.foodMenuId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid food item selected.",
        });
      }

      if (
        !Number.isInteger(Number(item.quantity)) ||
        Number(item.quantity) < 1
      ) {
        return res.status(400).json({
          success: false,
          message: "Item quantity must be a whole number greater than zero.",
        });
      }

      if (
        item.specialInstructions !== undefined &&
        typeof item.specialInstructions !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Special instructions must be text.",
        });
      }
    }

    // Prevent duplicate food item IDs
    const foodMenuIds = items.map((item) => item.foodMenuId.toString());

    if (new Set(foodMenuIds).size !== foodMenuIds.length) {
      return res.status(400).json({
        success: false,
        message: "Duplicate food items found. Please combine their quantities.",
      });
    }

    let createdOrder;
    let createdKots = [];

    // ---------------------------------------------
    // 3. Transaction: create order + KOTs + occupy seats
    // ---------------------------------------------

    await session.withTransaction(async () => {
      // Reset these values in case the transaction callback is retried.
      createdKots = [];

      // Verify the assigned Captain belongs to this restaurant.
      const captainUser = await User.findOne({
        _id: captainId,
        restaurantId,
        isActive: true,
      }).session(session);

      if (!captainUser) {
        const error = new Error(
          "Selected Captain account not found or inactive.",
        );
        error.statusCode = 400;
        throw error;
      }

      // Verify that the selected user's role is CAPTAIN.
      const captainRole = await Role.findOne({
        _id: captainUser.roleId,
        restaurantId,
        code: "CAPTAIN",
        isActive: true,
      }).session(session);

      if (!captainRole) {
        const error = new Error(
          "Selected user does not have an active Captain role.",
        );
        error.statusCode = 400;
        throw error;
      }

      // A. Verify selected floor
      const floor = await Floor.findOne({
        _id: floorId,
        restaurantId,
        isActive: true,
      }).session(session);

      if (!floor) {
        const error = new Error("Selected floor is invalid or inactive.");
        error.statusCode = 400;
        throw error;
      }

      // B. Verify selected table belongs to this floor and restaurant
      const table = await Table.findOne({
        _id: tableId,
        restaurantId,
        floorId,
        isActive: true,
      }).session(session);

      if (!table) {
        const error = new Error("Selected table is invalid or inactive.");
        error.statusCode = 400;
        throw error;
      }

      // C. Check selected guests against total table capacity
      if (guests > table.seatingCapacity) {
        const error = new Error(
          `This table has a maximum seating capacity of ${table.seatingCapacity} guests.`,
        );
        error.statusCode = 400;
        throw error;
      }

      // D. Verify food items are available for Dine-In
      const foodMenus = await FoodMenu.find({
        _id: { $in: foodMenuIds },
        restaurantId,
        isActive: true,
        isAvailable: true,
        availableFor: "Dine-In",
      }).session(session);

      if (foodMenus.length !== items.length) {
        const error = new Error(
          "One or more selected food items are unavailable for Dine-In.",
        );
        error.statusCode = 400;
        throw error;
      }

      // E. Verify every food item has a valid active kitchen station.
      const kitchenStationIds = [
        ...new Set(foodMenus.map((food) => food.kitchenStationId?.toString())),
      ];

      if (
        kitchenStationIds.some(
          (stationId) => !stationId || stationId === "undefined",
        )
      ) {
        const error = new Error(
          "One or more food items do not have an assigned kitchen station.",
        );
        error.statusCode = 400;
        throw error;
      }

      const kitchenStations = await KitchenStation.find({
        _id: { $in: kitchenStationIds },
        restaurantId,
        isActive: true,
      }).session(session);

      if (kitchenStations.length !== kitchenStationIds.length) {
        const error = new Error(
          "One or more assigned kitchen stations are invalid or inactive.",
        );
        error.statusCode = 400;
        throw error;
      }

      const kitchenStationMap = new Map(
        kitchenStations.map((station) => [station._id.toString(), station]),
      );

      // F. Calculate prices and GST using database values
      const foodMenuMap = new Map(
        foodMenus.map((food) => [food._id.toString(), food]),
      );

      let subTotal = 0;
      let totalGst = 0;

      const orderItems = items.map((item) => {
        const food = foodMenuMap.get(item.foodMenuId.toString());

        const quantity = Number(item.quantity);
        const unitPrice = Number(food.price);
        const gstRate = Number(food.gstRate ?? 5);

        const itemSubTotal = roundMoney(unitPrice * quantity);

        const gstAmount = roundMoney((itemSubTotal * gstRate) / 100);

        const totalPrice = roundMoney(itemSubTotal + gstAmount);

        subTotal += itemSubTotal;
        totalGst += gstAmount;

        return {
          foodMenuId: food._id,
          itemName: food.itemName,
          quantity,
          unitPrice,
          itemSubTotal,
          gstRate,
          gstAmount,
          totalPrice,
          specialInstructions: item.specialInstructions?.trim() || "",
        };
      });

      subTotal = roundMoney(subTotal);
      totalGst = roundMoney(totalGst);

      const totalAmount = roundMoney(subTotal + totalGst);

      // G. Create an independent order for this customer group
      const order = new Order({
        restaurantId,
        orderType: "Dine-In",
        floorId,
        tableId,
        customerName: customerName.trim(),
        numberOfGuests: guests,
        captainId,
        items: orderItems,
        subTotal,
        totalGst,
        totalAmount,
        orderStatus: "Active",
        seatingStatus: "Seated",
        paymentStatus: "Unpaid",
      });

      // H. Save order inside transaction
      await order.save({ session });

      // ---------------------------------------------
      // I. Group order items by kitchen station
      // ---------------------------------------------

      const itemsByStation = new Map();

      for (const orderItem of orderItems) {
        const food = foodMenuMap.get(orderItem.foodMenuId.toString());

        const stationId = food.kitchenStationId.toString();

        if (!itemsByStation.has(stationId)) {
          itemsByStation.set(stationId, []);
        }

        itemsByStation.get(stationId).push({
          foodMenuId: orderItem.foodMenuId,
          itemName: orderItem.itemName,
          quantity: orderItem.quantity,
          specialInstructions: orderItem.specialInstructions,
          itemStatus: "New",
        });
      }

      // ---------------------------------------------
      // J. Create one KOT for each kitchen station
      // ---------------------------------------------

      const kotDocuments = [];

      for (const [stationId, stationItems] of itemsByStation) {
        const station = kitchenStationMap.get(stationId);

        kotDocuments.push({
          restaurantId,
          kotNumber: `KOT-${station.code}-${order._id.toString().toUpperCase()}`,
          orderId: order._id,
          kitchenStationId: station._id,
          kitchenStationName: station.name,
          kitchenStationCode: station.code,
          floorId,
          tableId,
          customerName: customerName.trim(),
          numberOfGuests: guests,
          captainId,
          items: stationItems,
          kotStatus: "New",
        });
      }

      const savedKots = await KOT.insertMany(kotDocuments, { session });

      createdKots = savedKots;

      // ---------------------------------------------
      // K. Atomically reserve seats on the table
      // ---------------------------------------------

      const occupiedTable = await Table.findOneAndUpdate(
        {
          _id: tableId,
          restaurantId,
          floorId,
          isActive: true,

          $expr: {
            $lte: [
              {
                $add: [{ $ifNull: ["$occupiedSeats", 0] }, guests],
              },
              "$seatingCapacity",
            ],
          },
        },
        {
          $inc: {
            occupiedSeats: guests,
          },
          $addToSet: {
            currentOrderIds: order._id,
          },
        },
        {
          new: true,
          session,
          runValidators: true,
        },
      );

      if (!occupiedTable) {
        const error = new Error(
          "Not enough seats are available at this table. Please select another table.",
        );
        error.statusCode = 409;
        throw error;
      }

      // L. Set occupancy status based on updated seat count
      const newOccupancyStatus =
        occupiedTable.occupiedSeats >= occupiedTable.seatingCapacity
          ? "Fully Occupied"
          : "Partially Occupied";

      await Table.updateOne(
        {
          _id: tableId,
          restaurantId,
        },
        {
          $set: {
            occupancyStatus: newOccupancyStatus,
          },
        },
        { session },
      );

      createdOrder = order;
    });

    // ---------------------------------------------
    // 4. Return order and generated KOTs
    // ---------------------------------------------

    return res.status(201).json({
      success: true,
      message: "Dine-In order and kitchen tickets created successfully.",
      data: {
        order: createdOrder,
        kots: createdKots,
      },
    });
  } catch (error) {
    console.error("Create Dine-In Order Error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Failed to create Dine-In order.",
    });
  } finally {
    await session.endSession();
  }
};
