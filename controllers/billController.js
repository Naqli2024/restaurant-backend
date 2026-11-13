
import mongoose from "mongoose";
import Bill from "../models/Bill.js";
import Order from "../models/Order.js";

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

      // Bill can only be generated after Captain requests it
      if (order.paymentStatus !== "Bill Requested") {
        throw new Error(
          "Bill can only be generated for orders with Bill Requested status."
        );
      }

      if (order.orderStatus !== "Active") {
        throw new Error("Cannot generate a bill for an inactive order.");
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
        captainId: order.captainId,
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
      "Bill can only be generated for orders with Bill Requested status.",
      "Cannot generate a bill for an inactive order.",
      "A bill has already been generated for this order.",
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
      const billAmount = Math.round(
        (bill.totalAmount + Number.EPSILON) * 100
      ) / 100;

      if (totalPaid !== billAmount) {
        throw new Error(
          `Total payment must equal the bill amount of ${billAmount}.`
        );
      }

      // Determine whether payment is single-method or mixed
      const methods = [
        ...new Set(payments.map((payment) => payment.paymentMethod)),
      ];

      bill.paymentMethod =
        methods.length === 1 ? methods[0] : "Mixed";

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

    const isAmountError = error.message.startsWith(
      "Total payment must equal"
    );

    return res.status(
      clientErrors.includes(error.message) || isAmountError ? 400 : 500
    ).json({
      success: false,
      message: error.message || "Failed to collect payment.",
    });
  } finally {
    await session.endSession();
  }
};
