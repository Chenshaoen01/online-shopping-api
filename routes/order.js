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

router.post('/', async (req, res) => {
  const { cart_id } = req.body;
  const order_id = uuidv4();
  console.log(cart_id)
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 檢查購物車是否存在，並取得 user_id
    const [cartResults] = await connection.query(
      `SELECT user_id FROM cart WHERE cart_id = ?`,
      [cart_id]
    );
    if (cartResults.length === 0) {
      return res.status(404).json({ message: '購物車不存在。' });
    }
    const user_id = cartResults[0].user_id;

    // 獲取購物車內的商品明細
    const [cartItems] = await connection.query(
      `SELECT 
         ci.cart_item_id,
         ci.product_id,
         ci.model_id,
         ci.quantity,
         n.product_name,
         m.model_name,
         m.model_price
       FROM cart_item ci
       JOIN model m ON ci.model_id = m.model_id
       JOIN product n ON ci.product_id = n.product_id
       WHERE ci.cart_id = ?`,
      [cart_id]
    );

    if (cartItems.length === 0) {
      return res.status(400).json({ message: '購物車內無商品。' });
    }

    // 計算訂單總金額
    const total_price = cartItems.reduce(
      (acc, item) => acc + item.model_price * item.quantity,
      0
    );

    // 插入 order 記錄
    await connection.query(
      `INSERT INTO \`order\` (order_id, user_id, total_price, order_status) 
       VALUES (?, ?, ?, 'Pending')`,
      [order_id, user_id, total_price]
    );

    // 插入 order_item 記錄
    for (const item of cartItems) {
      const order_item_id = uuidv4();
      await connection.query(
        `INSERT INTO order_item (order_item_id, order_id, product_name, model_name, quantity, model_price) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          order_item_id,
          order_id,
          item.product_name,
          item.model_name,
          item.quantity,
          item.model_price,
        ]
      );
    }

    // 清空購物車
    await connection.query(`DELETE FROM cart_item WHERE cart_id = ?`, [cart_id]);

    await connection.commit();
    res.status(201).json({ message: '訂單已成功創建', order_id });
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
    // 查詢訂單總數
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM \`order\``);
    const lastPage = Math.ceil(total / limit);

    // 計算 pageList
    let startPage = Math.max(1, page - 2);
    let endPage = Math.min(lastPage, page + 2);

    // 調整 pageList 範圍，確保最多顯示5個頁碼
    if (endPage - startPage < 4) {
      if (startPage === 1) {
        endPage = Math.min(lastPage, startPage + 4);
      } else if (endPage === lastPage) {
        startPage = Math.max(1, endPage - 4);
      }
    }

    const pageList = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);

    // 查詢訂單資料，使用分頁
    const [orders] = await pool.query(
      `SELECT o.order_id, o.user_id, o.total_price, o.order_status, o.created_at, 
              u.user_name 
       FROM \`order\` o
       JOIN user u ON o.user_id = u.user_id
       ORDER BY o.created_at DESC 
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

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

      ordersWithItems.push({ ...order, items: orderItems });
    }

    res.json({
      dataList: ordersWithItems,
      lastPage,
      pageList
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

    const [user] = await pool.query(
      `SELECT user_id, user_name, user_email, user_tel from user WHERE user_id = ?`, order[0].user_id
    )

    // 查詢 order_item 並結合 product 和 model 表的資料
    const [orderItems] = await pool.query( `SELECT * FROM order_item WHERE order_id = ?`, [order_id]);

    res.json({
      order: order[0],
      user: user[0],
      items: orderItems
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 批量更新訂單狀態
router.put('/orderStatus', async (req, res) => {
  const { order_ids, order_status } = req.body;

  // 驗證輸入
  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return res.status(400).json({ error: 'Please provide an array of order IDs' });
  }

  try {
    // 使用 IN 條件批量更新
    const [result] = await pool.query(
      `UPDATE \`order\` SET order_status = ? WHERE order_id IN (?)`,
      [order_status, order_ids]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'No orders found to update' });
    }

    res.json({ message: 'Order statuses updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 刪除訂單及相關商品明細
router.delete('/', async (req, res) => {
  const { order_ids } = req.body;

  // 驗證輸入
  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return res.status(400).json({ error: 'Please provide an array of order IDs' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 刪除 order_item 記錄
    await connection.query(
      `DELETE FROM order_item WHERE order_id IN (?)`,
      [order_ids]
    );

    // 刪除 order 記錄
    const [result] = await connection.query(
      `DELETE FROM \`order\` WHERE order_id IN (?)`,
      [order_ids]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'No orders found to delete' });
    }

    await connection.commit();
    res.json({ message: 'Orders and related items deleted successfully' });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
