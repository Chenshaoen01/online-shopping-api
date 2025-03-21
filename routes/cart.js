const express = require('express');
const router = express.Router();
const pool = require('@helpers/connection');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const csurf = require('csurf');
const { verifyJWT, verifyCsrfToken } = require('@middlewares/auth');
const { getCartData } = require('@helpers/cartAction');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

router.use(cookieParser());

// 查詢客戶購物車內容(如果原本沒有購物車就新建購物車)
router.post('/', verifyJWT, async (req, res) => {
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

    const cartData = await getCartData(cart_id,)

    // 返回購物車ID及商品資料（含圖片）
    res.status(200).json(cartData);
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: "JWT token 無效或已過期。" });
    }
    res.status(500).json({ error: err.message });
  }
});

// 新增商品到購物車
router.post('/items', verifyJWT, verifyCsrfToken, async (req, res) => {
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
    if (cart.length === 0) {
      return res.status(401).json({ message: "購物車不存在，請重新嘗試。" });
    }

    const cart_id = cart[0].cart_id;
    const { product_id, model_id, quantity } = req.body;

    if (!product_id || !model_id || !quantity) {
      return res.status(400).json({ message: "請提供完整的商品資訊。" });
    }

    // 新增商品到購物車
    const cart_item_id = uuidv4();
    await pool.query(
      `INSERT INTO cart_item (cart_item_id, cart_id, product_id, model_id, quantity) VALUES (?, ?, ?, ?, ?)`,
      [cart_item_id, cart_id, product_id, model_id, quantity]
    );

    res.status(201).json({ message: "商品已添加到購物車" });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: "JWT token 無效或已過期。" });
    }
    res.status(500).json({ error: err.message });
  }
});

router.delete('/items/:cart_item_id', verifyJWT, verifyCsrfToken, async (req, res) => {
  const { cart_item_id } = req.params;
  try {
    await pool.query(`DELETE FROM cart_item WHERE cart_item_id = ?`, [cart_item_id]);
    res.json({ message: '商品已從購物車中移除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
