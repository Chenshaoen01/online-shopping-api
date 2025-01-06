const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('@helpers/connection');
const { verifyJWT, verifyCsrfToken } = require('@middlewares/auth');
const { getCartData } = require('@helpers/cartAction');
require('dotenv').config();

// 取得環境變數
const { MERCHANTID, HASHKEY, HASHIV, HOST } = process.env;
const JWT_SECRET = process.env.JWT_SECRET;

// 綠界提供的 SDK
const ecpay_payment = require('ecpay_aio_nodejs');

// SDK 初始化
const options = {
  OperationMode: 'Test', //Test or Production
  MercProfile: {
    MerchantID: MERCHANTID,
    HashKey: HASHKEY,
    HashIV: HASHIV,
  },
  IgnorePayment: [
    //  "Credit",
    //  "WebATM",
    //  "ATM",
    //  "CVS",
    //  "BARCODE",
    //  "AndroidPay"
  ],
  IsProjectContractor: false,
};

router.get('/', verifyJWT,async (req, res) => {
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
    merchant_trade_no = generateTradeNo(20);
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
  
      // 更新產品是否上架
      await connection.query(
        `UPDATE cart SET merchant_trade_no = ? WHERE cart_id IN (?)`,
        [merchant_trade_no, cart_id]
      );
  
      await connection.commit();
    } catch (err) {
      await connection.rollback();
    } finally {
      connection.release();
    }
  } else {
    return res.status(400).json({ message: "查無購物車資料" });
  }

  const cartData = await getCartData(cart_id)

  // SDK 參數設定
  const MerchantTradeDate = new Date().toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  let base_param = {
    MerchantTradeNo: merchant_trade_no, //請帶20碼uid, ex: f0a0d7e9fae1bb72bc93
    MerchantTradeDate,
    TotalAmount: `${cartData.total_price}`,
    TradeDesc: '測試交易描述',
    ItemName: '測試商品等',
    ReturnURL: `${HOST}/return`,
    ClientBackURL: `${HOST}/clientReturn`,
  };
  const create = new ecpay_payment(options);

  const html = create.payment_client.aio_check_out_all(base_param);

  res.render('index', {
    title: '訂單處理中',
    html,
  });
});

function generateTradeNo(length = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const timestamp = Date.now().toString(36); // 以 base-36 編碼的時間戳，壓縮時間長度
  const randomLength = length - timestamp.length; // 剩餘長度
  let randomPart = '';
  
  for (let i = 0; i < randomLength; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return `${timestamp}${randomPart}`; // 時間戳放在前面，後面補隨機字
}

// 接收綠界回傳的資料
router.post('/return', async (req, res) => {
  console.log('req.body:', req.body);

  const { CheckMacValue } = req.body;
  const data = { ...req.body };
  delete data.CheckMacValue; // 此段不驗證

  const create = new ecpay_payment(options);
  const checkValue = create.payment_client.helper.gen_chk_mac_value(data);

  console.log(
    '確認交易正確性：',
    CheckMacValue === checkValue,
    CheckMacValue,
    checkValue,
  );

  // 交易成功後，需要回傳 1|OK 給綠界
  res.send('1|OK');
});

// 用戶交易完成後的轉址
router.get('/clientReturn', (req, res) => {
  console.log('clientReturn:', req.body, req.query);
  res.render('return', { query: req.query });
});

module.exports = router;
