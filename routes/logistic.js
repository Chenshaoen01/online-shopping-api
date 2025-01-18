const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const pool = require('@helpers/connection');
const { verifyJWT, verifyCsrfToken } = require('@middlewares/auth');
require('dotenv').config();

// 取得環境變數
const { LOGISTIC_MERCHANTID, LOGISTIC_HASHKEY, LOGISTIC_HASHIV } = process.env;
const LOGISTIC_MERCHANTID_INT = parseInt(LOGISTIC_MERCHANTID)
const JWT_SECRET = process.env.JWT_SECRET;

const CvsTypeOptions = [
  { CvsTypeCode: "UNIMART", CvsTypeName: "7-11" },
  { CvsTypeCode: "FAMI", CvsTypeName: "全家" }
]

router.get('/getCvsTypeOptions', function(req, res) {
  res.status(200).json(CvsTypeOptions);
})

//計算檢查碼的函式
function CreateCMV(targetCvsType) {
  const CMVparams = {
      CvsType: targetCvsType,
      MerchantID: LOGISTIC_MERCHANTID_INT
  }

  function DotNETURLEncode(string) {
    const list = {
      "%2D": "-",
      "%5F": "_",
      "%2E": ".",
      "%21": "!",
      "%2A": "*",
      "%28": "(",
      "%29": ")",
      "%20": "+",
    };

    Object.entries(list).forEach(([encoded, decoded]) => {
      const regex = new RegExp(encoded, "g");
      string = string.replace(regex, decoded);
    });

    return string;
  }

  const Step1 = Object.keys(CMVparams)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${CMVparams[key]}`)
    .join("&");
  const Step2 = `HashKey=${LOGISTIC_HASHKEY}&${Step1}&HashIV=${LOGISTIC_HASHIV}`;
  const Step3 = DotNETURLEncode(encodeURIComponent(Step2));
  const Step4 = Step3.toLowerCase();
  const Step5 = crypto.createHash("MD5").update(Step4).digest("hex");
  const Step6 = Step5.toUpperCase();

  return Step6;
}

//收到請求時，執行 CreateCMV，僅回應檢查碼，由前端處理後續
router.post("/createCMV", (req, res) => {
  const result = CreateCMV(req.body);
  res.send(result);
});

//收到請求時，計算檢查碼，並且接續呼叫綠界 API
router.post("/getCheckMacValue", async (req, res) => {
  const payload = {
    MerchantID: LOGISTIC_MERCHANTID_INT,
    CvsType: req.body.CvsType,
    CheckMacValue: CreateCMV(req.body.CvsType),
  };

  try {
    const ecpayResponse=await axios({
      method:'post',
      url: "https://logistics-stage.ecpay.com.tw/Helper/GetStoreList",
      headers:{
        'Accept':'text/html',
        'Content-Type':'application/x-www-form-urlencoded'
      },
      data: new URLSearchParams(payload).toString()
    });
    res.send(ecpayResponse.data)
  } catch (error) {
    res.status(500).send("發生錯誤！" + error.message);
  }
});

router.post('/setLogisticData', verifyJWT, verifyCsrfToken, async function(req, res) {
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

  if (cart.length > 0) {
    // 如果購物車已存在，取得購物車ID
    cart_id = cart[0].cart_id;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const { storeId, storeName, csvType } = req.body
      // 更新物流資訊
      await connection.query(
        `UPDATE cart SET store_id = ?, store_name = ?, csv_type = ? WHERE cart_id IN (?)`,
        [storeId, storeName, csvType, cart_id]
      );

      await connection.commit();
      return res.status(200).json({ message: "購物車物流資料更新成功" });
    } catch (err) {
      await connection.rollback();
      return res.status(400).json({ message: "購物車物流資料更新失敗" });
    } finally {
      connection.release();
    }
  } else {
    return res.status(400).json({ message: "查無購物車資料" });
  }
})

module.exports = router;