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
    // 1. Only CAPTAIN can create Dine-In orders
    if (req.user.roleCode !== "CAPTAIN") {
      return res.status(403).json({
        success: false,
        message: "Only Captain can create Dine-In orders.",
      });
    }

    const restaurantId = req.user.restaurantId;

    // Automatically assign the logged-in Captain
    const captainId = req.user.userId;

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
      message: error.message
    });
  } finally {
    await session.endSession();
  }
};


// =====================================================
// 3. GET COMPLETE ORDER DETAILS BY ORDER ID
// =====================================================

export const getOrderById = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { orderId } = req.params;

    // 1. Validate Order ID
    if (!orderId || !mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID.",
      });
    }

    // 2. Find order belonging to the logged-in restaurant
    const order = await Order.findOne({
      _id: orderId,
      restaurantId,
    })
      .populate({
        path: "floorId",
        select: "floorName floorCode",
      })
      .populate({
        path: "tableId",
        select: "tableName seatingCapacity",
      })
      .populate({
        path: "captainId",
        select: "username employeeId",
        populate: {
          path: "employeeId",
          select: "employeeName employeeCode",
        },
      })
      .lean();

    // 3. Check whether order exists
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    // 4. Return complete order details
    return res.status(200).json({
      success: true,
      message: "Order details fetched successfully.",
      data: order,
    });
  } catch (error) {
    console.error("Get Order By ID Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch order details.",
    });
  }
};


// =====================================================
// 4. CAPTAIN REQUESTS BILL FOR AN ORDER
// =====================================================

export const requestBill = async (req, res) => {
  try {
    // 1. Only Captain can request a bill
    if (req.user.roleCode !== "CAPTAIN") {
      return res.status(403).json({
        success: false,
        message: "Only Captain can request a bill.",
      });
    }

    const restaurantId = req.user.restaurantId;
    const captainId = req.user.userId;
    const { orderId } = req.params;

    // 2. Validate Order ID
    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID.",
      });
    }

    // 3. Find this Captain's Order in this restaurant
    const order = await Order.findOne({
      _id: orderId,
      restaurantId,
      captainId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found or you are not assigned to this order.",
      });
    }

    // 4. Check Order status
    if (order.orderStatus !== "Active") {
      return res.status(400).json({
        success: false,
        message: "Bill cannot be requested for an inactive order.",
      });
    }

    if (order.seatingStatus !== "Seated") {
      return res.status(400).json({
        success: false,
        message: "Bill cannot be requested because this customer group has already left.",
      });
    }

    // 5. Prevent duplicate bill requests
    if (
      order.paymentStatus === "Bill Requested" ||
      order.paymentStatus === "Payment Pending"
    ) {
      return res.status(400).json({
        success: false,
        message: "Bill has already been requested or generated.",
      });
    }

    if (order.paymentStatus === "Paid") {
      return res.status(400).json({
        success: false,
        message: "This order has already been paid.",
      });
    }

    // 6. Update Order payment status
    order.paymentStatus = "Bill Requested";

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Bill requested successfully. Please inform the cashier.",
      data: {
        orderId: order._id,
        customerName: order.customerName,
        orderType: order.orderType,
        tableId: order.tableId,
        totalAmount: order.totalAmount,
        paymentStatus: order.paymentStatus,
      },
    });
  } catch (error) {
    console.error("Request Bill Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to request bill.",
    });
  }
};


export const getBillRequests = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;
    const roleCode = req.user.roleCode;

    // Only ADMIN and CASHIER can view bill requests
    if (!["ADMIN", "CASHIER"].includes(roleCode)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view bill requests.",
      });
    }

    // Retrieve orders where Captain has requested a bill
    const billRequests = await Order.find({
      restaurantId,
      paymentStatus: "Bill Requested",
      orderStatus: "Active",
    })
      .populate({
        path: "floorId",
        select: "floorName floorCode",
      })
      .populate({
        path: "tableId",
        select: "tableName seatingCapacity",
      })
      .populate({
        path: "captainId",
        select: "username employeeId",
        populate: {
          path: "employeeId",
          select: "employeeName employeeCode",
        },
      })
      .sort({ createdAt: 1 }) // Oldest requests first
      .lean();

    return res.status(200).json({
      success: true,
      message: "Bill requests fetched successfully.",
      count: billRequests.length,
      data: billRequests,
    });
  } catch (error) {
    console.error("Get Bill Requests Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch bill requests.",
      error: error.message,
    });
  }
};


// Customer Checkout / Release Table Seats
export const checkoutOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const restaurantId = req.user.restaurantId;
    const captainId = req.user.userId;
    const roleCode = req.user.roleCode;
    const { orderId } = req.params;

    // Only Captain can checkout their own customer orders
    if (roleCode !== "CAPTAIN") {
      return res.status(403).json({
        success: false,
        message: "Only the assigned Captain can checkout this order.",
      });
    }

    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID.",
      });
    }

    let checkoutResult;

    await session.withTransaction(async () => {
      // Find order assigned to the logged-in Captain
      const order = await Order.findOne({
        _id: orderId,
        restaurantId,
        captainId,
      }).session(session);

      if (!order) {
        throw new Error("Order not found or not assigned to you.");
      }

      // Order must be fully paid
      if (order.paymentStatus !== "Paid") {
        throw new Error(
          "Customer must complete full payment before checkout."
        );
      }

      // Prevent duplicate checkout
      if (order.seatingStatus === "Left") {
        throw new Error("This customer group has already checked out.");
      }

      if (order.seatingStatus !== "Seated") {
        throw new Error("This order is not currently seated.");
      }

      if (order.orderStatus !== "Active") {
        throw new Error("Only active orders can be checked out.");
      }

      // Find the table belonging to this restaurant
      const table = await Table.findOne({
        _id: order.tableId,
        restaurantId,
      }).session(session);

      if (!table) {
        throw new Error("Table not found.");
      }

      // Verify this order is currently registered on the table
      const orderExistsOnTable = table.currentOrderIds.some(
        (id) => String(id) === String(order._id)
      );

      if (!orderExistsOnTable) {
        throw new Error(
          "This order is not registered in the table's current orders."
        );
      }

      // Prevent occupied seats from becoming negative
      if (table.occupiedSeats < order.numberOfGuests) {
        throw new Error(
          "Table occupancy data is inconsistent. Please check the occupied seats."
        );
      }

      // Release only this customer's seats
      table.occupiedSeats -= order.numberOfGuests;

      // Remove only this order from the table
      table.currentOrderIds = table.currentOrderIds.filter(
        (id) => String(id) !== String(order._id)
      );

      // Recalculate table occupancy
      if (table.occupiedSeats === 0) {
        table.occupancyStatus = "Available";
      } else if (table.occupiedSeats < table.seatingCapacity) {
        table.occupancyStatus = "Partially Occupied";
      } else {
        table.occupancyStatus = "Fully Occupied";
      }

      // Mark customer group as checked out
      order.seatingStatus = "Left";
      order.orderStatus = "Completed";

      await table.save({ session });
      await order.save({ session });

      checkoutResult = {
        orderId: order._id,
        customerName: order.customerName,
        numberOfGuests: order.numberOfGuests,
        paymentStatus: order.paymentStatus,
        seatingStatus: order.seatingStatus,
        orderStatus: order.orderStatus,
        table: {
          tableId: table._id,
          tableName: table.tableName,
          seatingCapacity: table.seatingCapacity,
          occupiedSeats: table.occupiedSeats,
          availableSeats:
            table.seatingCapacity - table.occupiedSeats,
          occupancyStatus: table.occupancyStatus,
          currentOrderIds: table.currentOrderIds,
        },
      };
    });

    return res.status(200).json({
      success: true,
      message: "Customer checkout completed and seats released successfully.",
      data: checkoutResult,
    });
  } catch (error) {
    console.error("Checkout Order Error:", error);

    const clientErrors = [
      "Order not found or not assigned to you.",
      "Customer must complete full payment before checkout.",
      "This customer group has already checked out.",
      "This order is not currently seated.",
      "Only active orders can be checked out.",
      "Table not found.",
      "This order is not registered in the table's current orders.",
      "Table occupancy data is inconsistent. Please check the occupied seats.",
    ];

    return res
      .status(clientErrors.includes(error.message) ? 400 : 500)
      .json({
        success: false,
        message: error.message || "Failed to checkout customer.",
      });
  } finally {
    await session.endSession();
  }
};


// =====================================================
// CREATE TAKEAWAY / DELIVERY ORDER
// =====================================================

export const createTakeawayDeliveryOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const restaurantId = req.user.restaurantId;
    const createdBy = req.user.userId;
    const roleCode = req.user.roleCode;

    // 1. Only ADMIN, CAPTAIN and CASHIER can create these orders
    if (!["ADMIN", "CAPTAIN", "CASHIER"].includes(roleCode)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to create this order.",
      });
    }

    const {
      orderType,
      customerName,
      customerMobile,
      deliveryAddress,
      deliveryChannel,
      deliveryCharges,
      items,
    } = req.body;

    // 2. Validate order type
    if (!["Takeaway", "Delivery"].includes(orderType)) {
      return res.status(400).json({
        success: false,
        message: "Order type must be Takeaway or Delivery.",
      });
    }

    // 3. Validate customer details
    if (
      typeof customerName !== "string" ||
      !customerName.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Customer name is required.",
      });
    }

    if (
      typeof customerMobile !== "string" ||
      !customerMobile.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Customer mobile number is required.",
      });
    }

    if (
      orderType === "Delivery" &&
      (typeof deliveryAddress !== "string" || !deliveryAddress.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Delivery address is required for Delivery orders.",
      });
    }

    // 4. Validate delivery charges
    const charges = Number(deliveryCharges ?? 0);

    if (!Number.isFinite(charges) || charges < 0) {
      return res.status(400).json({
        success: false,
        message: "Delivery charges must be a valid non-negative amount.",
      });
    }

    if (orderType === "Takeaway" && charges > 0) {
      return res.status(400).json({
        success: false,
        message: "Delivery charges are not applicable to Takeaway orders.",
      });
    }

    // 5. Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please add at least one food item.",
      });
    }

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

    // 6. Create order and KOTs in one transaction
    await session.withTransaction(async () => {
      createdKots = [];

      // A. Verify menu items are available for this order type
      const foodMenus = await FoodMenu.find({
        _id: { $in: foodMenuIds },
        restaurantId,
        isActive: true,
        isAvailable: true,
        availableFor: orderType,
      }).session(session);

      if (foodMenus.length !== items.length) {
        const error = new Error(
          `One or more selected food items are unavailable for ${orderType}.`
        );
        error.statusCode = 400;
        throw error;
      }

      // B. Validate kitchen station assignments
      const kitchenStationIds = [
        ...new Set(
          foodMenus.map((food) => food.kitchenStationId?.toString())
        ),
      ];

      if (
        kitchenStationIds.some(
          (stationId) => !stationId || stationId === "undefined"
        )
      ) {
        const error = new Error(
          "One or more food items do not have an assigned kitchen station."
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
          "One or more assigned kitchen stations are invalid or inactive."
        );
        error.statusCode = 400;
        throw error;
      }

      const kitchenStationMap = new Map(
        kitchenStations.map((station) => [
          station._id.toString(),
          station,
        ])
      );

      // C. Calculate item prices and GST from database values
      const foodMenuMap = new Map(
        foodMenus.map((food) => [food._id.toString(), food])
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

      // Delivery charges are added after item GST
      const totalAmount = roundMoney(
        subTotal + totalGst + (orderType === "Delivery" ? charges : 0)
      );

      // D. Create the order
      const order = new Order({
        restaurantId,
        orderType,
        floorId: null,
        tableId: null,
        customerName: customerName.trim(),
        customerMobile: customerMobile.trim(),
        deliveryAddress:
          orderType === "Delivery" ? deliveryAddress.trim() : "",
        deliveryChannel: deliveryChannel?.trim() || "Direct",
        deliveryCharges: orderType === "Delivery" ? charges : 0,
        numberOfGuests: null,
        captainId: null,
        createdBy,
        items: orderItems,
        subTotal,
        totalGst,
        totalAmount,
        fulfilmentStatus: "Pending",
        orderStatus: "Active",
        seatingStatus: "Not Applicable",
        paymentStatus: "Unpaid",
      });

      await order.save({ session });

      // E. Group order items by kitchen station
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

      // F. Create one KOT per kitchen station
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
          floorId: null,
          tableId: null,
          customerName: customerName.trim(),
          numberOfGuests: 1,
          captainId: null,
          items: stationItems,
          kotStatus: "New",
        });
      }

      const savedKots = await KOT.insertMany(kotDocuments, { session });

      createdKots = savedKots;
      createdOrder = order;
    });

    // 7. Return created order and KOTs
    return res.status(201).json({
      success: true,
      message: `${orderType} order and kitchen tickets created successfully.`,
      data: {
        order: createdOrder,
        kots: createdKots,
      },
    });
  } catch (error) {
    console.error("Create Takeaway / Delivery Order Error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Failed to create Takeaway / Delivery order.",
    });
  } finally {
    await session.endSession();
  }
};



// =====================================================
// UPDATE TAKEAWAY / DELIVERY FULFILMENT STATUS
// =====================================================

export const updateFulfilmentStatus = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;
    const roleCode = req.user.roleCode;
    const { orderId } = req.params;
    const { status } = req.body;

    // 1. Only ADMIN and CASHIER can manage fulfilment
    if (!["ADMIN", "CASHIER"].includes(roleCode)) {
      return res.status(403).json({
        success: false,
        message: "Only Admin or Cashier can update fulfilment status.",
      });
    }

    // 2. Validate order ID
    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID.",
      });
    }

    // 3. Validate requested status
    const allowedStatuses = [
      "Handed Over",
      "Dispatched",
      "Delivered",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid fulfilment status.",
      });
    }

    // 4. Find order belonging to this restaurant
    const order = await Order.findOne({
      _id: orderId,
      restaurantId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    // 5. Only Takeaway and Delivery orders
    if (!["Takeaway", "Delivery"].includes(order.orderType)) {
      return res.status(400).json({
        success: false,
        message: "This endpoint is only for Takeaway and Delivery orders.",
      });
    }

    // 6. Only active orders can be processed
    if (order.orderStatus !== "Active") {
      return res.status(400).json({
        success: false,
        message: "Only active orders can be processed.",
      });
    }

    // 7. Validate the allowed status transition
    const isValidTransition =
      (order.orderType === "Takeaway" &&
        order.fulfilmentStatus === "Ready" &&
        status === "Handed Over") ||
      (order.orderType === "Delivery" &&
        order.fulfilmentStatus === "Ready" &&
        status === "Dispatched") ||
      (order.orderType === "Delivery" &&
        order.fulfilmentStatus === "Dispatched" &&
        status === "Delivered");

    if (!isValidTransition) {
      return res.status(400).json({
        success: false,
        message: `Cannot change fulfilment status from ${order.fulfilmentStatus} to ${status} for ${order.orderType}.`,
      });
    }

    // 8. Before handover or dispatch, verify all station KOTs are Ready
    if (
      order.fulfilmentStatus === "Ready" &&
      ["Handed Over", "Dispatched"].includes(status)
    ) {
      const kots = await KOT.find({
        restaurantId,
        orderId: order._id,
      }).select("kotStatus").lean();

      if (!kots.length) {
        return res.status(400).json({
          success: false,
          message: "No kitchen tickets found for this order.",
        });
      }

      const allKotsReady = kots.every(
        (kot) => kot.kotStatus === "Ready"
      );

      if (!allKotsReady) {
        return res.status(400).json({
          success: false,
          message: "All kitchen tickets must be Ready before handover or dispatch.",
        });
      }
    }

    // 9. Update fulfilment status
    order.fulfilmentStatus = status;

    await order.save();

    return res.status(200).json({
      success: true,
      message: `Order ${status.toLowerCase()} successfully.`,
      data: {
        orderId: order._id,
        orderType: order.orderType,
        customerName: order.customerName,
        fulfilmentStatus: order.fulfilmentStatus,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
      },
    });
  } catch (error) {
    console.error("Update Fulfilment Status Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update fulfilment status.",
    });
  }
};
