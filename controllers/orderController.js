import mongoose from "mongoose";

import Floor from "../models/Floor.js";
import Table from "../models/Table.js";
import FoodMenu from "../models/FoodMenu.js";
import Order from "../models/Order.js";
import KitchenStation from "../models/KitchenStation.js";
import KOT from "../models/KOT.js";
import User from "../models/User.js";
import Role from "../models/Role.js";
import Bill from "../models/Bill.js";

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

    // if (
    //   !customerName ||
    //   typeof customerName !== "string" ||
    //   !customerName.trim()
    // ) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Customer name is required.",
    //   });
    // }

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
      message: error.message,
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
        message:
          "Bill cannot be requested because this customer group has already left.",
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
        throw new Error("Customer must complete full payment before checkout.");
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
        (id) => String(id) === String(order._id),
      );

      if (!orderExistsOnTable) {
        throw new Error(
          "This order is not registered in the table's current orders.",
        );
      }

      // Prevent occupied seats from becoming negative
      if (table.occupiedSeats < order.numberOfGuests) {
        throw new Error(
          "Table occupancy data is inconsistent. Please check the occupied seats.",
        );
      }

      // Release only this customer's seats
      table.occupiedSeats -= order.numberOfGuests;

      // Remove only this order from the table
      table.currentOrderIds = table.currentOrderIds.filter(
        (id) => String(id) !== String(order._id),
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
          availableSeats: table.seatingCapacity - table.occupiedSeats,
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

    return res.status(clientErrors.includes(error.message) ? 400 : 500).json({
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
    if (typeof customerName !== "string" || !customerName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Customer name is required.",
      });
    }

    if (typeof customerMobile !== "string" || !customerMobile.trim()) {
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
          `One or more selected food items are unavailable for ${orderType}.`,
        );
        error.statusCode = 400;
        throw error;
      }

      // B. Validate kitchen station assignments
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

      // C. Calculate item prices and GST from database values
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

      // Delivery charges are added after item GST
      const totalAmount = roundMoney(
        subTotal + totalGst + (orderType === "Delivery" ? charges : 0),
      );

      // D. Create the order
      const order = new Order({
        restaurantId,
        orderType,
        floorId: null,
        tableId: null,
        customerName: customerName.trim(),
        customerMobile: customerMobile.trim(),
        deliveryAddress: orderType === "Delivery" ? deliveryAddress.trim() : "",
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
    const allowedStatuses = ["Handed Over", "Dispatched", "Delivered"];

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
        status === "Delivered") ||
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
      })
        .select("kotStatus")
        .lean();

      if (!kots.length) {
        return res.status(400).json({
          success: false,
          message: "No kitchen tickets found for this order.",
        });
      }

      const allKotsReady = kots.every((kot) => kot.kotStatus === "Ready");

      if (!allKotsReady) {
        return res.status(400).json({
          success: false,
          message:
            "All kitchen tickets must be Ready before handover or dispatch.",
        });
      }
    }

    // 9. Update fulfilment status and order status
    order.fulfilmentStatus = status;

    // Complete Takeaway after Handed Over
    if (order.orderType === "Takeaway" && status === "Handed Over") {
      order.orderStatus = "Completed";
    }

    // Complete Delivery after Delivered
    if (order.orderType === "Delivery" && status === "Delivered") {
      order.orderStatus = "Completed";
    }

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

// Cancel Takeaway / Delivery Order
export const cancelOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    const roleCode = req.user.roleCode;
    const userId = req.user.userId;
    const restaurantId = req.user.restaurantId;

    // Only ADMIN, CASHIER, and CAPTAIN can cancel orders.
    if (!["ADMIN", "CASHIER", "CAPTAIN"].includes(roleCode)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to cancel orders.",
      });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: "Cancellation reason is required.",
      });
    }

    let cancelledOrder;

    await session.withTransaction(async () => {
      const order = await Order.findOne({
        _id: orderId,
        restaurantId,
      }).session(session);

      if (!order) {
        throw new Error("Order not found.");
      }

      // This controller currently handles Takeaway and Delivery.
      if (!["Takeaway", "Delivery"].includes(order.orderType)) {
        throw new Error("This API supports Takeaway and Delivery orders only.");
      }

      if (order.orderStatus !== "Active") {
        throw new Error("Only active orders can be cancelled.");
      }

      // A Captain can cancel only an order created by them.
      if (
        roleCode === "CAPTAIN" &&
        order.createdBy?.toString() !== userId.toString()
      ) {
        throw new Error("You can cancel only orders created by you.");
      }

      // Prevent cancellation after handover or dispatch.
      if (
        order.fulfilmentStatus === "Handed Over" ||
        order.fulfilmentStatus === "Dispatched" ||
        order.fulfilmentStatus === "Delivered"
      ) {
        throw new Error(
          "This order has already been handed over or dispatched. Normal cancellation is not allowed.",
        );
      }

      // Paid orders must go through the refund process.
      if (order.paymentStatus === "Paid") {
        throw new Error(
          "This order is already paid. Use the refund process instead.",
        );
      }

      if (
        order.paymentStatus !== "Unpaid" &&
        order.paymentStatus !== "Payment Pending"
      ) {
        throw new Error(
          "This order cannot be cancelled in its current payment status.",
        );
      }

      // Find an existing bill, if one was generated.
      const bill = await Bill.findOne({
        restaurantId,
        orderId: order._id,
      }).session(session);

      if (bill) {
        if (bill.billStatus === "Paid") {
          throw new Error(
            "This order has a paid bill. Use the refund process instead.",
          );
        }

        if (bill.billStatus === "Generated") {
          bill.billStatus = "Cancelled";
          await bill.save({ session });
        }
      }

      const now = new Date();

      // Cancel all KOTs and their individual items.
      const kots = await KOT.find({
        restaurantId,
        orderId: order._id,
      }).session(session);

      for (const kot of kots) {
        kot.kotStatus = "Cancelled";
        kot.cancelledAt = now;

        for (const item of kot.items) {
          item.itemStatus = "Cancelled";
        }

        await kot.save({ session });
      }

      // Cancel the order.
      order.orderStatus = "Cancelled";
      order.cancellationReason = reason.trim();
      order.cancelledBy = userId;
      order.cancelledAt = now;

      await order.save({ session });

      cancelledOrder = order;
    });

    return res.status(200).json({
      success: true,
      message: `${cancelledOrder.orderType} order cancelled successfully.`,
      data: cancelledOrder,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to cancel order.",
    });
  } finally {
    await session.endSession();
  }
};

// Get Ready Takeaway and Delivery Orders for Cashier
export const getCashierReadyOrders = async (req, res) => {
  try {
    const roleCode = req.user.roleCode;
    const restaurantId = req.user.restaurantId;

    if (!["ADMIN", "CASHIER"].includes(roleCode)) {
      return res.status(403).json({
        success: false,
        message: "Only Admin and Cashier can access ready orders.",
      });
    }

    const orders = await Order.find({
      restaurantId,
      orderType: {
        $in: ["Takeaway", "Delivery"],
      },
      orderStatus: "Active",
      fulfilmentStatus: "Ready",
    })
      .populate("createdBy", "username")
      .sort({ createdAt: 1 });

    return res.status(200).json({
      success: true,
      message: "Ready Takeaway and Delivery orders fetched successfully.",
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch ready orders.",
    });
  }
};

// captain  dashboard
export const getCaptainDashboard = async (req, res) => {
  try {
    const { restaurantId, userId } = req.user;
    const roleCode = req.user.roleCode;

    if (!["CAPTAIN", "ADMIN"].includes(roleCode)) {
      return res.status(403).json({
        success: false,
        message: "Only Captain or Admin can access this dashboard.",
      });
    }

    // Use India local dates. If no dates are supplied, use today.
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const fromDate = req.query.fromDate || today;
    const toDate = req.query.toDate || fromDate;

    const isValidDate = (date) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;

      const [year, month, day] = date.split("-").map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));

      return (
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
      );
    };

    if (!isValidDate(fromDate) || !isValidDate(toDate) || fromDate > toDate) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide valid fromDate and toDate in YYYY-MM-DD format.",
      });
    }

    const startDate = new Date(`${fromDate}T00:00:00.000+05:30`);
    const endDate = new Date(`${toDate}T00:00:00.000+05:30`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);

    const todayStart = new Date(`${today}T00:00:00.000+05:30`);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);

    const restaurantObjectId = new mongoose.Types.ObjectId(restaurantId);
    const captainObjectId = new mongoose.Types.ObjectId(userId);

    const dateFilter = {
      $gte: startDate,
      $lt: endDate,
    };

    // Current open Dine-In orders
    const openOrders = await Order.find({
      restaurantId,
      orderType: "Dine-In",
      orderStatus: "Active",
      seatingStatus: "Seated",
      captainId: { $ne: null },
    })
      .populate("tableId", "tableName seatingCapacity occupancyStatus")
      .select("captainId tableId customerName numberOfGuests createdAt")
      .lean();

    // Current Ready KOTs belonging to Dine-In captains
    const readyKots = await KOT.find({
      restaurantId,
      captainId: { $ne: null },
      kotStatus: "Ready",
    })
      .select("captainId kotNumber orderId tableId customerName items")
      .lean();

    // Completed Dine-In orders within the selected date range.
    // Date filtering currently uses the order's createdAt date.
    const completedOrders = await Order.find({
      restaurantId,
      orderType: "Dine-In",
      orderStatus: "Completed",
      captainId: { $ne: null },
      createdAt: dateFilter,
    })
      .select("captainId orderType totalAmount createdAt")
      .lean();

    // Paid bill sales, grouped by captain
    const allTimeSales = await Bill.aggregate([
      {
        $match: {
          restaurantId: restaurantObjectId,
          billStatus: "Paid",
          captainId: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$captainId",
          totalSales: { $sum: "$paidAmount" },
        },
      },
    ]);

    const rangeSales = await Bill.aggregate([
      {
        $match: {
          restaurantId: restaurantObjectId,
          billStatus: "Paid",
          captainId: { $ne: null },
          paidAt: dateFilter,
        },
      },
      {
        $group: {
          _id: "$captainId",
          totalSales: { $sum: "$paidAmount" },
        },
      },
    ]);

    const todaySales = await Bill.aggregate([
      {
        $match: {
          restaurantId: restaurantObjectId,
          billStatus: "Paid",
          captainId: { $ne: null },
          paidAt: {
            $gte: todayStart,
            $lt: tomorrowStart,
          },
        },
      },
      {
        $group: {
          _id: "$captainId",
          totalSales: { $sum: "$paidAmount" },
        },
      },
    ]);

    // Date-wise paid sales
    const salesByDate = await Bill.aggregate([
      {
        $match: {
          restaurantId: restaurantObjectId,
          billStatus: "Paid",
          captainId: { $ne: null },
          paidAt: dateFilter,
        },
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$paidAt",
                timezone: "Asia/Kolkata",
              },
            },
            captainId: "$captainId",
          },
          totalSales: { $sum: "$paidAmount" },
        },
      },
      { $sort: { "_id.date": 1 } },
    ]);

    // Date-wise completed orders
    const completedOrdersByDate = await Order.aggregate([
      {
        $match: {
          restaurantId: restaurantObjectId,
          orderType: "Dine-In",
          orderStatus: "Completed",
          captainId: { $ne: null },
          createdAt: dateFilter,
        },
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
                timezone: "Asia/Kolkata",
              },
            },
            captainId: "$captainId",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.date": 1 } },
    ]);

    const getCaptainTotal = (records, captainId) => {
      const record = records.find(
        (item) => item._id.toString() === captainId.toString(),
      );

      return record?.totalSales || 0;
    };

    const getCaptainOpenOrders = (captainId) =>
      openOrders.filter(
        (order) => order.captainId.toString() === captainId.toString(),
      );

    const getCaptainReadyKots = (captainId) =>
      readyKots.filter(
        (kot) => kot.captainId.toString() === captainId.toString(),
      );

    const getCaptainCompletedOrders = (captainId) =>
      completedOrders.filter(
        (order) => order.captainId.toString() === captainId.toString(),
      );

    const getUniqueTables = (orders) => {
      const tables = new Map();

      orders.forEach((order) => {
        if (order.tableId?._id) {
          tables.set(order.tableId._id.toString(), order.tableId);
        }
      });

      return Array.from(tables.values());
    };

    const getReadyItemDetails = (kots) => {
      const result = [];

      kots.forEach((kot) => {
        const readyItems = (kot.items || []).filter(
          (item) => item.itemStatus === "Ready",
        );

        readyItems.forEach((item) => {
          result.push({
            kotId: kot._id,
            kotNumber: kot.kotNumber,
            orderId: kot.orderId,
            tableId: kot.tableId,
            customerName: kot.customerName,
            itemName: item.itemName,
            quantity: item.quantity,
            itemStatus: item.itemStatus,
          });
        });
      });

      return result;
    };

    const getReadyQuantity = (items) =>
      items.reduce((total, item) => total + item.quantity, 0);

    const allCaptainIds = new Set([
      ...openOrders.map((order) => order.captainId.toString()),
      ...readyKots.map((kot) => kot.captainId.toString()),
      ...completedOrders.map((order) => order.captainId.toString()),
      ...allTimeSales.map((sale) => sale._id.toString()),
      ...rangeSales.map((sale) => sale._id.toString()),
    ]);

    const captainBreakdown = Array.from(allCaptainIds).map((captainId) => {
      const captainOpenOrders = getCaptainOpenOrders(captainId);
      const captainReadyItems = getReadyItemDetails(
        getCaptainReadyKots(captainId),
      );
      const captainCompletedOrders = getCaptainCompletedOrders(captainId);

      return {
        captainId,
        openTables: getUniqueTables(captainOpenOrders).length,
        readyItemLines: captainReadyItems.length,
        readyItemQuantity: getReadyQuantity(captainReadyItems),
        completedOrders: captainCompletedOrders.length,
        salesInSelectedRange: getCaptainTotal(rangeSales, captainId),
        overallSales: getCaptainTotal(allTimeSales, captainId),
        salesToday: getCaptainTotal(todaySales, captainId),
      };
    });

    const overallOpenTables = getUniqueTables(openOrders);
    const overallReadyItems = getReadyItemDetails(readyKots);

    const myOpenOrders =
      roleCode === "CAPTAIN" ? getCaptainOpenOrders(userId) : [];
    const myReadyItems =
      roleCode === "CAPTAIN"
        ? getReadyItemDetails(getCaptainReadyKots(userId))
        : [];
    const myCompletedOrders =
      roleCode === "CAPTAIN" ? getCaptainCompletedOrders(userId) : [];

    const myDashboard =
      roleCode === "CAPTAIN"
        ? {
            openTables: getUniqueTables(myOpenOrders).length,
            openTableDetails: getUniqueTables(myOpenOrders),
            readyItemLines: myReadyItems.length,
            readyItemQuantity: getReadyQuantity(myReadyItems),
            readyItems: myReadyItems,
            completedOrders: myCompletedOrders.length,
            salesToday: getCaptainTotal(todaySales, userId),
            salesInSelectedRange: getCaptainTotal(rangeSales, userId),
            overallSales: getCaptainTotal(allTimeSales, userId),
          }
        : null;

    const overallDashboard = {
      openTables: overallOpenTables.length,
      readyItemLines: overallReadyItems.length,
      readyItemQuantity: getReadyQuantity(overallReadyItems),
      completedOrders: completedOrders.length,
      salesToday: todaySales.reduce(
        (total, item) => total + item.totalSales,
        0,
      ),
      salesInSelectedRange: rangeSales.reduce(
        (total, item) => total + item.totalSales,
        0,
      ),
      overallSales: allTimeSales.reduce(
        (total, item) => total + item.totalSales,
        0,
      ),
    };

    const mySalesByDate = salesByDate
      .filter((item) => item._id.captainId.toString() === userId)
      .map((item) => ({
        date: item._id.date,
        totalSales: item.totalSales,
      }));

    const myCompletedOrdersByDate = completedOrdersByDate
      .filter((item) => item._id.captainId.toString() === userId)
      .map((item) => ({
        date: item._id.date,
        count: item.count,
      }));

    const overallSalesByDate = {};
    salesByDate.forEach((item) => {
      overallSalesByDate[item._id.date] =
        (overallSalesByDate[item._id.date] || 0) + item.totalSales;
    });

    const overallCompletedOrdersByDate = {};
    completedOrdersByDate.forEach((item) => {
      overallCompletedOrdersByDate[item._id.date] =
        (overallCompletedOrdersByDate[item._id.date] || 0) + item.count;
    });

    return res.status(200).json({
      success: true,
      message: "Captain dashboard fetched successfully.",
      dateRange: {
        fromDate,
        toDate,
        timezone: "Asia/Kolkata",
      },
      myDashboard,
      overallDashboard,
      dateWise: {
        mySales: mySalesByDate,
        myCompletedOrders: myCompletedOrdersByDate,
        overallSales: Object.entries(overallSalesByDate).map(
          ([date, totalSales]) => ({ date, totalSales }),
        ),
        overallCompletedOrders: Object.entries(
          overallCompletedOrdersByDate,
        ).map(([date, count]) => ({ date, count })),
      },
      captainBreakdown,
    });
  } catch (error) {
    console.error("Get captain dashboard error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch captain dashboard.",
      error: error.message,
    });
  }
};

// orders By captainId
export const getOrdersByCaptainId = async (req, res) => {
  try {
    const { restaurantId, userId, roleCode } = req.user;
    const { captainId } = req.params;

    // Only ADMIN and CAPTAIN can access
    if (!["ADMIN", "CAPTAIN"].includes(roleCode)) {
      return res.status(403).json({
        success: false,
        message: "Only Admin or Captain can view captain orders.",
      });
    }

    // Validate captainId
    if (!mongoose.Types.ObjectId.isValid(captainId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid captainId.",
      });
    }

    // Captain can view only their own orders
    if (roleCode === "CAPTAIN" && captainId !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only view your own orders.",
      });
    }

    // Verify that the selected user is an active Captain
    const captainRole = await Role.findOne({
      restaurantId,
      code: "CAPTAIN",
      isActive: true,
    }).select("_id");

    if (!captainRole) {
      return res.status(404).json({
        success: false,
        message: "Captain role not found.",
      });
    }

    const captain = await User.findOne({
      _id: captainId,
      restaurantId,
      roleId: captainRole._id,
      isActive: true,
    }).select("_id username");

    if (!captain) {
      return res.status(404).json({
        success: false,
        message: "Active captain not found in this restaurant.",
      });
    }

    // Fetch orders assigned to this Captain
    const orders = await Order.find({
      restaurantId,
      captainId: captain._id,
    })
      .populate("floorId")
      .populate("tableId")
      .populate("captainId", "username")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Captain orders fetched successfully.",

      captain: {
        captainId: captain._id,
        captainName: captain.username,
      },

      count: orders.length,
      data: orders,
    });
  } catch (error) {
    console.error("Get orders by captain error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch captain orders.",
      error: error.message,
    });
  }
};
