const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('@helpers/connection');
const { verifyJWT, verifyCsrfToken } = require('@middlewares/auth');
const { getCartData } = require('@helpers/cartAction');
require('dotenv').config();

// 取得環境變數
const { MERCHANTID, HASHKEY, HASHIV, HOST, CUSTOMER_SYSTEM_URL } = process.env;
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

router.get('/', verifyJWT, async (req, res) => {
  // 從 Cookie 中取得 JWT token
  const token = req.cookies.jwt;

  if (!token) {
    return res.status(401).json({ message: "未登入。" });
  }

  // 驗證並解碼 JWT token
  const decoded = jwt.verify(token, JWT_SECRET);
  const user_id = decoded.user_id;

  // 取得訂單編號
  const orderId = req.query.orderId

  // 取出該訂單資料
  const [order] = await pool.query(`SELECT * FROM \`order\` WHERE order_Id = ? AND user_id = ?`, [orderId, user_id]);
  if (order.length > 0) {
    let merchant_trade_no = generateTradeNo(20);
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 更新 merchant_trade_no
      await connection.query(
        `UPDATE \`order\` SET merchant_trade_no = ? WHERE order_Id = ?`,
        [merchant_trade_no, orderId]
      );

      await connection.commit();
    } catch (err) {
      await connection.rollback();
    } finally {
      connection.release();
    }

    const orderData = order[0]

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
      TotalAmount: `${parseFloat(orderData.total_price)}`,
      TradeDesc: '測試交易描述',
      ItemName: '測試商品等',
      ReturnURL: `${HOST}/ecpayment/return`,
      ClientBackURL: `${CUSTOMER_SYSTEM_URL}/User/Order/Detail/${orderData.order_id}`,
    };
    const create = new ecpay_payment(options);

    const html = create.payment_client.aio_check_out_all(base_param);

    res.render('index', {
      title: '訂單處理中',
      html,
    });
  } else {
    return res.status(400).json({ message: "查無訂單資料" });
  }
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
  const { CheckMacValue } = req.body;
  const data = { ...req.body };
  delete data.CheckMacValue; // 此段不驗證
  console.log(data)

  if(data.RtnCode === '1') {
    // 取出該訂單資料
    const [orders] = await pool.query(`SELECT * FROM \`order\` WHERE merchant_trade_no = ?`, [data.MerchantTradeNo]);
    if(orders.length > 0) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
  
        // 更新 merchant_trade_no
        await connection.query(
          `UPDATE \`order\` SET order_status = ? WHERE merchant_trade_no = ?`,
          ['已付款', data.MerchantTradeNo]
        );
  
        await connection.commit();
      } catch (err) {
        await connection.rollback();
      } finally {
        connection.release();
      }
    }
  }

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
  res.render('return', { query: req.query });
});

module.exports = router;
