const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const csurf = require('csurf');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MY_SQL_PATH,
  user: process.env.MY_SQL_USER_NAME,
  password: process.env.MY_SQL_PQSSWORD,
  database: process.env.MY_SQL_DB_NAME
});

const JWT_SECRET = process.env.JWT_SECRET;

// const csrfProtection = csurf({ cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production' } });

router.use(cookieParser());
// router.use(csrfProtection);

// CSRF token 驗證中介軟體
const verifyCsrfToken = (req, res, next) => {
  const csrfToken = req.headers['x-csrf-token'] || req.body.csrfToken;
  if (csrfToken !== req.cookies.csrfToken) {
    return res.status(403).json({ message: "無效的 CSRF token。" });
  }
  next();
};

// 使用中介軟體
// router.use(verifyCsrfToken);

router.post('/', async (req, res) => {
  // 從 Cookie 中取得 JWT token
  const token = req.cookies.jwt;
  
  if (!token) {
    return res.status(401).json({ message: "未登入。" });
  }

  try {
    // 驗證並解碼 JWT token
    const decoded = jwt.verify(token, JWT_SECRET);
    const user_id = decoded.user_id;

    // 檢查是否已存在購物車
    const [cart] = await pool.query(`SELECT cart_id FROM cart WHERE user_id = ?`, [user_id]);
    let cart_id;
    if (cart.length > 0) {
      // 如果購物車已存在，取得購物車ID
      cart_id = cart[0].cart_id;
    } else {
      // 創建新的購物車
      cart_id = uuidv4();
      await pool.query(`INSERT INTO cart (cart_id, user_id) VALUES (?, ?)`, [cart_id, user_id]);
    }

    // 查詢購物車內的商品項目
    const [items] = await pool.query(`SELECT * FROM cart_item WHERE cart_id = ?`, [cart_id]);

    // 返回購物車ID及購物車內的商品項目
    res.status(200).json({
      cart_id,
      cart_items: items
    });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: "JWT token 無效或已過期。" });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post('/items', async (req, res) => {
  const { cart_id, product_id, model_id, quantity, price } = req.body;
  try {
    const cart_item_id = uuidv4();
    await pool.query(
      `INSERT INTO cart_item (cart_item_id, cart_id, product_id, model_id, quantity) VALUES (?, ?, ?, ?, ?)`,
      [cart_item_id, cart_id, product_id, model_id, quantity]
    );
    res.status(201).json({ message: '商品已添加到購物車' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:cart_id', async (req, res) => {
  const { cart_id } = req.params;

  try {
    // 使用 JOIN 從 cart_item 取得對應的 model 和 product 資訊
    const [items] = await pool.query(
      `SELECT ci.cart_id, ci.quantity, 
              p.product_name, p.product_img, m.model_name, m.model_price 
       FROM cart_item ci
       JOIN model m ON ci.model_id = m.model_id
       JOIN product p ON m.product_id = p.product_id
       WHERE ci.cart_id = ?`,
      [cart_id]
    );

    // 回傳包含產品與型號資訊的購物車項目
    res.json({ cart_items: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/items/:cart_item_id', async (req, res) => {
  const { cart_item_id } = req.params;
  try {
    await pool.query(`DELETE FROM cart_item WHERE cart_item_id = ?`, [cart_item_id]);
    res.json({ message: '商品已從購物車中移除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
