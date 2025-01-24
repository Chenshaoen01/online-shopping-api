const express = require('express');
const router = express.Router();
const pool = require('@helpers/connection');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { verifyJWT, verifyAdmin, verifyCsrfToken } = require('@middlewares/auth');
require('dotenv').config();

const { createOrder } = require('@helpers/orderAction');

const JWT_SECRET = process.env.JWT_SECRET;

// 建立訂單
router.post('/', verifyJWT, async (req, res) => {
  // 從 Cookie 中取得 JWT token
  const token = req.cookies.jwt;
  
  if (!token) {
    return res.status(401).json({ message: "未登入。" });
  }

  // 驗證並解碼 JWT token
  const decoded = jwt.verify(token, JWT_SECRET);
  const user_id = decoded.user_id;

  // 檢查是否已存在購物車
  const [cart] = await pool.query(`SELECT cart_id,merchant_trade_no FROM cart WHERE user_id = ?`, [user_id]);
  let cart_id;
  let merchant_trade_no;

  if (cart.length > 0) {
    // 如果購物車已存在，取得購物車ID
    cart_id = cart[0].cart_id;

    const { storeId, storeName, csvType } = req.body
  
    try {
      const user_id = decoded.user_id;
      const orderCreateResult = await createOrder(cart_id, user_id, storeId, storeName, csvType);
      if(orderCreateResult.statusCode === 200) {
        res.status(201).json({ message: '訂單已成功創建', orderId: orderCreateResult.orderId });
      } else {
        res.status(400).json({ message: '訂單建立失敗' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    return res.status(400).json({ message: "查無購物車資料" });
  }
});

// 依照頁數查詢訂單列表
router.get('/',verifyJWT, verifyAdmin, verifyCsrfToken, async (req, res) => {
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

// 客戶查詢自己的所有訂單
router.get('/userOrders', verifyJWT, async (req, res) => {
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
    // 返回所有訂單
    res.json(orders);
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: "JWT token 無效或已過期。" });
    }
    res.status(500).json({ error: err.message });
  }
});

// 查詢單一訂單
router.get('/:order_id', verifyJWT, async (req, res) => {
  const { order_id } = req.params;
  try {
    // 查詢 order 資料
    const [order] = await pool.query(
      `SELECT * FROM \`order\` WHERE order_id = ?`,
      [order_id]
    );
    console.log(order)
    if (order.length === 0) {
      return res.status(404).json({ message: '找不到對應的訂單' });
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

// 更新訂單狀態
router.put('/orderStatus', verifyJWT, verifyAdmin, verifyCsrfToken, async (req, res) => {
  const { order_ids, order_status } = req.body;

  // 驗證輸入
  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return res.status(400).json({ message: '須指定欲修改訂單狀態的訂單' });
  }

  try {
    // 使用 IN 條件批量更新
    const [result] = await pool.query(
      `UPDATE \`order\` SET order_status = ? WHERE order_id IN (?)`,
      [order_status, order_ids]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '找不到對應的訂單' });
    }

    res.json({ message: '訂單狀態調整成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 刪除訂單及相關商品明細
router.delete('/', verifyJWT, verifyAdmin, verifyCsrfToken, async (req, res) => {
  const { order_ids } = req.body;

  // 驗證輸入
  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return res.status(400).json({ message: '須指定欲刪除的訂單' });
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
      return res.status(404).json({ message: '找不到對應的訂單' });
    }

    await connection.commit();
    res.json({ message: '訂單刪除成功' });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
