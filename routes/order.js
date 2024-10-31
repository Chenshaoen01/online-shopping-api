const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MY_SQL_PATH,
  user: process.env.MY_SQL_USER_NAME,
  password: process.env.MY_SQL_PQSSWORD,
  database: process.env.MY_SQL_DB_NAME
});

const JWT_SECRET = process.env.JWT_SECRET;

// 創建訂單
router.post('/', async (req, res) => {
  const { cart_id } = req.body;
  const order_id = uuidv4();

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 查詢 cart 以獲取 user_id
    const [cartResults] = await connection.query(
      `SELECT user_id FROM cart WHERE cart_id = ?`,
      [cart_id]
    );
    if (cartResults.length === 0) {
      throw new Error('Cart not found');
    }
    const user_id = cartResults[0].user_id;

    // 查詢 cart_item 和 model 以獲取商品及其價格和數量
    const [cartItems] = await connection.query(
      `SELECT ci.product_id, ci.model_id, ci.quantity, m.model_price AS price
       FROM cart_item ci
       JOIN model m ON ci.model_id = m.model_id
       WHERE ci.cart_id = ?`,
      [cart_id]
    );

    // 計算訂單總金額
    const total_price = cartItems.reduce((acc, item) => acc + item.price * item.quantity, 0);

    // 插入 order 資料
    await connection.query(
      `INSERT INTO \`order\` (order_id, user_id, total_price, order_status) VALUES (?, ?, ?, 'Pending')`,
      [order_id, user_id, total_price]
    );

    // 將每個 cart_item 插入 order_item 中
    for (const item of cartItems) {
      const order_item_id = uuidv4();
      await connection.query(
        `INSERT INTO order_item (order_item_id, order_id, product_name, model_name, quantity, model_price) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [order_item_id, order_id, item.product_id, item.model_id, item.quantity, item.price]
      );
    }

    await connection.commit();
    res.status(201).json({ message: 'Order created successfully', order_id });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 依照頁數查詢訂單列表
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    // 查詢訂單列表（每頁 10 筆，依頁數顯示）
    const [orders] = await pool.query(
      `SELECT * FROM \`order\` ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // 若無訂單，返回空資料
    if (orders.length === 0) {
      return res.json({ data: [], message: 'No orders found.' });
    }

    // 查詢每筆訂單的商品明細
    const ordersWithItems = [];
    for (const order of orders) {
      const [orderItems] = await pool.query(
        `SELECT oi.order_item_id, oi.quantity, oi.model_price, 
                p.product_name, m.model_name
         FROM order_item oi
         JOIN product p ON oi.product_name = p.product_id
         JOIN model m ON oi.model_name = m.model_id
         WHERE oi.order_id = ?`,
        [order.order_id]
      );

      ordersWithItems.push({
        order,
        items: orderItems
      });
    }

    res.json({
      current_page: page,
      per_page: limit,
      data: ordersWithItems
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 查詢客戶的所有訂單
router.get('/userOrders', async (req, res) => {
  // 從 Cookie 中取得 JWT token
  const token = req.cookies.jwt;

  if (!token) {
    return res.status(401).json({ message: "未登入。" });
  }

  try {
    // 驗證並解碼 JWT token
    const decoded = jwt.verify(token, JWT_SECRET);
    const user_id = decoded.user_id;

    // 查詢該客戶的所有訂單
    const [orders] = await pool.query(
      `SELECT * FROM \`order\` WHERE user_id = ?`,
      [user_id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ error: 'No orders found for this user.' });
    }

    // 為每個訂單查詢對應的 order_items
    const ordersWithItems = [];
    for (const order of orders) {
      const [orderItems] = await pool.query(
        `SELECT oi.order_item_id, oi.quantity, oi.model_price, 
                p.product_name, m.model_name
         FROM order_item oi
         JOIN product p ON oi.product_name = p.product_id
         JOIN model m ON oi.model_name = m.model_id
         WHERE oi.order_id = ?`,
        [order.order_id]
      );

      ordersWithItems.push({
        order,
        items: orderItems
      });
    }

    // 返回所有訂單及其商品明細
    res.json(ordersWithItems);
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: "JWT token 無效或已過期。" });
    }
    res.status(500).json({ error: err.message });
  }
});



// 查詢單一訂單
router.get('/:order_id', async (req, res) => {
  const { order_id } = req.params;
  try {
    // 查詢 order 資料
    const [order] = await pool.query(
      `SELECT * FROM \`order\` WHERE order_id = ?`,
      [order_id]
    );

    if (order.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // 查詢 order_item 並結合 product 和 model 表的資料
    const [orderItems] = await pool.query(
      `SELECT oi.order_item_id, oi.quantity, oi.model_price, 
              p.product_name, m.model_name
       FROM order_item oi
       JOIN product p ON oi.product_name = p.product_id
       JOIN model m ON oi.model_name = m.model_id
       WHERE oi.order_id = ?`,
      [order_id]
    );

    res.json({
      order: order[0],
      items: orderItems
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新訂單狀態
router.patch('/:order_id', async (req, res) => {
  const { order_id } = req.params;
  const { order_status } = req.body;
  try {
    await pool.query(`UPDATE \`order\` SET order_status = ? WHERE order_id = ?`, [order_status, order_id]);
    res.json({ message: 'Order status updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
