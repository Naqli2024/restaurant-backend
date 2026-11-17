import mongoose from "mongoose";
import Bill from "../models/Bill.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import Role from "../models/Role.js";

// Generate Bill
export const generateBill = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const restaurantId = req.user.restaurantId;
    const generatedBy = req.user.userId;
    const roleCode = req.user.roleCode;
    const { orderId } = req.params;

    // Only ADMIN and CASHIER can generate bills
    if (!["ADMIN", "CASHIER"].includes(roleCode)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to generate bills.",
      });
    }

    // Validate order ID
    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID.",
      });
    }

    let createdBill;

    await session.withTransaction(async () => {
      // Find order belonging to this restaurant
      const order = await Order.findOne({
        _id: orderId,
        restaurantId,
      }).session(session);

      if (!order) {
        throw new Error("Order not found.");
      }

      // Order must be active
      if (order.orderStatus !== "Active") {
        throw new Error("Cannot generate a bill for an inactive order.");
      }

      // Validate payment status according to order type
      if (order.orderType === "Dine-In") {
        if (order.paymentStatus !== "Bill Requested") {
          throw new Error(
            "Dine-In bill can only be generated after the Captain requests it.",
          );
        }
      } else if (["Takeaway", "Delivery"].includes(order.orderType)) {
        if (order.paymentStatus !== "Unpaid") {
          throw new Error(
            "Takeaway and Delivery bills can only be generated for unpaid orders.",
          );
        }
      } else {
        throw new Error("Invalid order type.");
      }

      // Check whether a bill already exists
      const existingBill = await Bill.findOne({
        restaurantId,
        orderId: order._id,
      }).session(session);

      if (existingBill) {
        throw new Error("A bill has already been generated for this order.");
      }

      // Generate a unique bill number
      const billNumber = `BILL-${new mongoose.Types.ObjectId()
        .toString()
        .slice(-8)
        .toUpperCase()}`;

      // Create bill using order details
      const bill = new Bill({
        restaurantId,
        billNumber,
        orderId: order._id,
        orderType: order.orderType,
        floorId: order.floorId || null,
        tableId: order.tableId || null,
        customerName: order.customerName,
        captainId: order.captainId || null,

        items: order.items.map((item) => ({
          foodMenuId: item.foodMenuId || null,
          itemName: item.itemName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          itemSubTotal: item.itemSubTotal,
          gstRate: item.gstRate,
          gstAmount: item.gstAmount,
          totalPrice: item.totalPrice,
          specialInstructions: item.specialInstructions || "",
        })),

        subTotal: order.subTotal,
        totalGst: order.totalGst,

        // Delivery charges are stored separately
        deliveryCharges:
          order.orderType === "Delivery" ? order.deliveryCharges || 0 : 0,

        totalAmount: order.totalAmount,
        billStatus: "Generated",
        generatedBy,
      });

      await bill.save({ session });

      // Update order payment status
      order.paymentStatus = "Payment Pending";
      await order.save({ session });

      createdBill = bill;
    });

    return res.status(201).json({
      success: true,
      message: "Bill generated successfully.",
      data: createdBill,
    });
  } catch (error) {
    console.error("Generate Bill Error:", error);

    const clientErrors = [
      "Order not found.",
      "Cannot generate a bill for an inactive order.",
      "Dine-In bill can only be generated after the Captain requests it.",
      "Takeaway and Delivery bills can only be generated for unpaid orders.",
      "A bill has already been generated for this order.",
      "Invalid order type.",
    ];

    return res.status(clientErrors.includes(error.message) ? 400 : 500).json({
      success: false,
      message: error.message || "Failed to generate bill.",
    });
  } finally {
    await session.endSession();
  }
};

export const collectPayment = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const restaurantId = req.user.restaurantId;
    const roleCode = req.user.roleCode;
    const { billId } = req.params;
    const { payments } = req.body;

    // Only ADMIN and CASHIER can collect payment
    if (!["ADMIN", "CASHIER"].includes(roleCode)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to collect payment.",
      });
    }

    if (!mongoose.isValidObjectId(billId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid bill ID.",
      });
    }

    // Validate payment details
    if (!Array.isArray(payments) || payments.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide payment details.",
      });
    }

    const allowedMethods = ["Cash", "UPI", "Card", "Other"];

    let totalPaid = 0;

    for (const payment of payments) {
      if (
        !allowedMethods.includes(payment.paymentMethod) ||
        typeof payment.amount !== "number" ||
        !Number.isFinite(payment.amount) ||
        payment.amount <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid payment method or amount.",
        });
      }

      totalPaid += payment.amount;
    }

    // Avoid floating-point precision issues
    totalPaid = Math.round((totalPaid + Number.EPSILON) * 100) / 100;

    let paidBill;

    await session.withTransaction(async () => {
      const bill = await Bill.findOne({
        _id: billId,
        restaurantId,
      }).session(session);

      if (!bill) {
        throw new Error("Bill not found.");
      }

      if (bill.billStatus !== "Generated") {
        throw new Error("This bill has already been paid or cancelled.");
      }

      const order = await Order.findOne({
        _id: bill.orderId,
        restaurantId,
      }).session(session);

      if (!order) {
        throw new Error("Corresponding order not found.");
      }

      if (order.paymentStatus !== "Payment Pending") {
        throw new Error("Order is not in Payment Pending status.");
      }

      // Full bill amount must be collected
      const billAmount =
        Math.round((bill.totalAmount + Number.EPSILON) * 100) / 100;

      if (totalPaid !== billAmount) {
        throw new Error(
          `Total payment must equal the bill amount of ${billAmount}.`,
        );
      }

      // Determine whether payment is single-method or mixed
      const methods = [
        ...new Set(payments.map((payment) => payment.paymentMethod)),
      ];

      bill.paymentMethod = methods.length === 1 ? methods[0] : "Mixed";

      bill.paymentDetails = payments.map((payment) => ({
        paymentMethod: payment.paymentMethod,
        amount: payment.amount,
      }));

      bill.paidAmount = totalPaid;
      bill.billStatus = "Paid";
      bill.paidAt = new Date();

      await bill.save({ session });

      order.paymentStatus = "Paid";
      await order.save({ session });

      paidBill = bill.toObject();
    });

    return res.status(200).json({
      success: true,
      message: "Full payment collected successfully.",
      data: paidBill,
    });
  } catch (error) {
    console.error("Collect Payment Error:", error);

    const clientErrors = [
      "Bill not found.",
      "This bill has already been paid or cancelled.",
      "Corresponding order not found.",
      "Order is not in Payment Pending status.",
    ];

    const isAmountError = error.message.startsWith("Total payment must equal");

    return res
      .status(clientErrors.includes(error.message) || isAmountError ? 400 : 500)
      .json({
        success: false,
        message: error.message || "Failed to collect payment.",
      });
  } finally {
    await session.endSession();
  }
};


export const getCashierPerformanceDashboard = async (req, res) => {
  try {
    const { restaurantId, userId, roleCode } = req.user;

    if (!["ADMIN", "CASHIER"].includes(roleCode)) {
      return res.status(403).json({
        success: false,
        message: "Only Admin or Cashier can access this dashboard.",
      });
    }

    // Default date: Today in India
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date());

    const fromDate = req.query.fromDate || today;
    const toDate = req.query.toDate || today;

    const isValidDate = (date) => {
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return false;
      }

      const [year, month, day] = date.split("-").map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));

      return (
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
      );
    };

    if (
      !isValidDate(fromDate) ||
      !isValidDate(toDate) ||
      fromDate > toDate
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid date range. Use YYYY-MM-DD.",
      });
    }

    // India timezone date boundaries
    const startDate = new Date(`${fromDate}T00:00:00.000+05:30`);
    const endDate = new Date(`${toDate}T00:00:00.000+05:30`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);

    const restaurantObjectId = new mongoose.Types.ObjectId(restaurantId);

    // --------------------------------------------------
    // 1. Find the CASHIER role for this restaurant
    // --------------------------------------------------

    const cashierRole = await Role.findOne({
      restaurantId: restaurantObjectId,
      code: "CASHIER",
    }).select("_id");

    if (!cashierRole) {
      return res.status(200).json({
        success: true,
        message: "No cashier role found for this restaurant.",
        dateRange: {
          fromDate,
          toDate,
          timezone: "Asia/Kolkata",
        },
        overall: {
          totalBills: 0,
          totalBillAmount: 0,
          paidBills: 0,
          unpaidBills: 0,
          cancelledBills: 0,
          totalCollected: 0,
        },
        cashierPerformance: [],
      });
    }

    // --------------------------------------------------
    // 2. Get actual cashier accounts
    // --------------------------------------------------

    const cashierUsers = await User.find({
      restaurantId: restaurantObjectId,
      roleId: cashierRole._id,
    }).select("_id username");

    let cashiersToShow = cashierUsers;

    // Cashier can see only their own dashboard.
    if (roleCode === "CASHIER") {
      cashiersToShow = cashierUsers.filter(
        (cashier) => cashier._id.toString() === userId.toString()
      );
    }

    // Admin can optionally select one cashier.
    if (roleCode === "ADMIN" && req.query.cashierId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.cashierId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid cashierId.",
        });
      }

      const selectedCashier = cashierUsers.find(
        (cashier) =>
          cashier._id.toString() === req.query.cashierId
      );

      if (!selectedCashier) {
        return res.status(404).json({
          success: false,
          message: "Cashier not found in this restaurant.",
        });
      }

      cashiersToShow = [selectedCashier];
    }

    const cashierIds = cashiersToShow.map((cashier) => cashier._id);

    const cashierIdStrings = cashierIds.map((id) => id.toString());

    // --------------------------------------------------
    // 3. Common filters
    // --------------------------------------------------

    const baseMatch = {
      restaurantId: restaurantObjectId,
      generatedBy: { $in: cashierIds },
    };

    // Bills generated within selected date range.
    const rangeMatch = {
      ...baseMatch,
      generatedAt: {
        $gte: startDate,
        $lt: endDate,
      },
    };

    // --------------------------------------------------
    // 4. Bill summary (based on generatedAt)
    // --------------------------------------------------

    const cashierSummaries = await Bill.aggregate([
      {
        $match: rangeMatch,
      },
      {
        $group: {
          _id: "$generatedBy",

          totalBills: {
            $sum: 1,
          },

          totalBillAmount: {
            $sum: "$totalAmount",
          },

          paidBills: {
            $sum: {
              $cond: [{ $eq: ["$billStatus", "Paid"] }, 1, 0],
            },
          },

          unpaidBills: {
            $sum: {
              $cond: [{ $eq: ["$billStatus", "Generated"] }, 1, 0],
            },
          },

          cancelledBills: {
            $sum: {
              $cond: [{ $eq: ["$billStatus", "Cancelled"] }, 1, 0],
            },
          },
        },
      },
    ]);

    // --------------------------------------------------
    // 5. Date-wise collections (based on paidAt)
    // --------------------------------------------------

    const dateWiseCollections = await Bill.aggregate([
      {
        $match: {
          ...baseMatch,
          billStatus: "Paid",
          paidAt: {
            $gte: startDate,
            $lt: endDate,
          },
        },
      },
      {
        $group: {
          _id: {
            cashierId: "$generatedBy",
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$paidAt",
                timezone: "Asia/Kolkata",
              },
            },
          },

          collectedAmount: {
            $sum: { $ifNull: ["$paidAmount", 0] },
          },
        },
      },
      {
        $sort: {
          "_id.date": 1,
        },
      },
    ]);

    // --------------------------------------------------
    // 6. Payment method breakdown (based on paidAt)
    // --------------------------------------------------

    const paymentBreakdown = await Bill.aggregate([
      {
        $match: {
          ...baseMatch,
          billStatus: "Paid",
          paidAt: {
            $gte: startDate,
            $lt: endDate,
          },
        },
      },
      {
        $unwind: "$paymentDetails",
      },
      {
        $group: {
          _id: {
            cashierId: "$generatedBy",
            paymentMethod: "$paymentDetails.paymentMethod",
          },

          amount: {
            $sum: "$paymentDetails.amount",
          },
        },
      },
    ]);

    // --------------------------------------------------
    // 7. Lifetime collection of each cashier
    // --------------------------------------------------

    const lifetimeSales = await Bill.aggregate([
      {
        $match: {
          ...baseMatch,
          billStatus: "Paid",
        },
      },
      {
        $group: {
          _id: "$generatedBy",

          totalCollected: {
            $sum: { $ifNull: ["$paidAmount", 0] },
          },

          totalPaidBills: {
            $sum: 1,
          },
        },
      },
    ]);

    // --------------------------------------------------
    // 8. Bill history generated during selected dates
    // --------------------------------------------------

    const billHistory = await Bill.find(baseMatch)
      .populate("generatedBy", "username")
      .populate("orderId", "orderType")
      .populate("captainId", "username")
      .sort({ generatedAt: -1 })
      .select(
        "billNumber orderId orderType customerName captainId " +
          "items subTotal totalGst deliveryCharges totalAmount " +
          "billStatus generatedBy generatedAt paidAmount paidAt " +
          "paymentMethod paymentDetails"
      )
      .lean();

    // --------------------------------------------------
    // 9. Date-wise bills generated
    // --------------------------------------------------

    const dateWiseBills = await Bill.aggregate([
      {
        $match: rangeMatch,
      },
      {
        $group: {
          _id: {
            cashierId: "$generatedBy",
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$generatedAt",
                timezone: "Asia/Kolkata",
              },
            },
          },

          billCount: {
            $sum: 1,
          },

          billAmount: {
            $sum: "$totalAmount",
          },
        },
      },
      {
        $sort: {
          "_id.date": 1,
        },
      },
    ]);

    // --------------------------------------------------
    // 10. Lifetime collection lookup
    // --------------------------------------------------

    const getLifetime = (cashierId) =>
      lifetimeSales.find(
        (item) => item._id.toString() === cashierId
      );

    // --------------------------------------------------
    // 11. Build individual cashier performance
    // --------------------------------------------------

    const cashierPerformance = cashiersToShow.map((cashier) => {
      const cashierId = cashier._id.toString();

      const summary = cashierSummaries.find(
        (item) => item._id.toString() === cashierId
      );

      const lifetime = getLifetime(cashierId);

      const myCollections = dateWiseCollections
        .filter(
          (item) => item._id.cashierId.toString() === cashierId
        );

      const totalCollected = myCollections.reduce(
        (total, item) => total + item.collectedAmount,
        0
      );

      const myPaymentMethods = paymentBreakdown
        .filter(
          (item) => item._id.cashierId.toString() === cashierId
        )
        .map((item) => ({
          paymentMethod: item._id.paymentMethod,
          amount: item.amount,
        }));

      const myBillHistory = billHistory
        .filter(
          (bill) =>
            bill.generatedBy?._id?.toString() === cashierId
        )
        .map((bill) => ({
          billId: bill._id,
          billNumber: bill.billNumber,

          orderId: bill.orderId?._id || bill.orderId,
          orderType: bill.orderType,

          customerName: bill.customerName,
          captain: bill.captainId?.username || null,

          items: bill.items,

          subTotal: bill.subTotal,
          totalGst: bill.totalGst,
          deliveryCharges: bill.deliveryCharges || 0,
          totalAmount: bill.totalAmount,

          billStatus: bill.billStatus,

          paidAmount: bill.paidAmount || 0,
          paidAt: bill.paidAt,

          paymentMethod: bill.paymentMethod,
          paymentDetails: bill.paymentDetails || [],

          generatedAt: bill.generatedAt,
        }));

      return {
        cashierId,
        cashierName: cashier.username,

        // Selected date range: bill generation
        totalBills: summary?.totalBills || 0,
        totalBillAmount: summary?.totalBillAmount || 0,

        paidBills: summary?.paidBills || 0,
        unpaidBills: summary?.unpaidBills || 0,
        cancelledBills: summary?.cancelledBills || 0,

        // Selected date range: actual collection
        totalCollected,

        paymentMethods: myPaymentMethods,

        // Lifetime figures
        overallSales: lifetime?.totalCollected || 0,
        lifetimePaidBills: lifetime?.totalPaidBills || 0,

        dateWiseBills: dateWiseBills
          .filter(
            (item) => item._id.cashierId.toString() === cashierId
          )
          .map((item) => ({
            date: item._id.date,
            billCount: item.billCount,
            billAmount: item.billAmount,
          })),

        dateWiseCollections: myCollections.map((item) => ({
          date: item._id.date,
          collectedAmount: item.collectedAmount,
        })),

        billHistory: myBillHistory,
      };
    });

    // --------------------------------------------------
    // 12. Overall dashboard (all selected cashiers)
    // --------------------------------------------------

    const overall = cashierPerformance.reduce(
      (result, cashier) => {
        result.totalBills += cashier.totalBills;
        result.totalBillAmount += cashier.totalBillAmount;

        result.paidBills += cashier.paidBills;
        result.unpaidBills += cashier.unpaidBills;
        result.cancelledBills += cashier.cancelledBills;

        result.totalCollected += cashier.totalCollected;

        result.overallSales += cashier.overallSales;

        return result;
      },
      {
        totalCashiers: cashierPerformance.length,

        totalBills: 0,
        totalBillAmount: 0,

        paidBills: 0,
        unpaidBills: 0,
        cancelledBills: 0,

        totalCollected: 0,
        overallSales: 0,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Cashier performance dashboard fetched successfully.",

      dateRange: {
        fromDate,
        toDate,
        timezone: "Asia/Kolkata",
      },

      overall,
      cashierPerformance,
    });
  } catch (error) {
    console.error("Cashier performance dashboard error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch cashier performance dashboard.",
      error: error.message,
    });
  }
};

