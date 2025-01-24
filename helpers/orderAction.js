const pool = require('@helpers/connection');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

async function createOrder(cart_id = "", user_id="", store_id="", store_name="", csv_type="") {
  const order_id = uuidv4();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
  
    // 檢查購物車是否存在，並取得 user_id
    const [cartResults] = await connection.query(
      `SELECT * FROM cart WHERE cart_id = ?`,
      [cart_id]
    );
    if (cartResults.length === 0) {
      return res.status(404).json({ message: '購物車不存在。' });
    }

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

    console.log(order_id, user_id, total_price, store_id, store_name, csv_type)
    // 插入 order 記錄
    await connection.query(
      `INSERT INTO \`order\` (order_id, user_id, total_price, order_status, store_id, store_name, csv_type) 
       VALUES (?, ?, ?, '未付款', ?, ?, ?)`,
      [order_id, user_id, total_price, store_id, store_name, csv_type]);

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
          item.model_price
        ]
      );
    }

    // 清空購物車
    await connection.query(`DELETE FROM cart_item WHERE cart_id = ?`, [cart_id]);
    await connection.query(`DELETE FROM cart WHERE cart_id = ?`, [cart_id]);

    await connection.commit();
    return {statusCode: 200, message: "訂單已成功創建", orderId: order_id}
  } catch (err) {
    await connection.rollback();
    console.log(err.message)
    return {statusCode: 500, message: err.message}
  } finally {
    connection.release();
  }
}

module.exports = {
    createOrder
}