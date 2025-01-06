const pool = require('@helpers/connection');
require('dotenv').config();

async function getCartData(cart_id = "") {
    // 查詢購物車內的商品項目及相關資訊
    const [items] = await pool.query(
        `SELECT 
       ci.cart_item_id,
       ci.product_id,
       ci.model_id,
       ci.quantity,
       p.product_name,
       p.is_active,
       m.model_name,
       m.model_price
     FROM cart_item ci
     JOIN product p ON ci.product_id = p.product_id
     JOIN model m ON ci.model_id = m.model_id
     WHERE ci.cart_id = ?`,
        [cart_id]
    );

    if (items.length === 0) {
        return { cart_id, cart_items: [], total_price: 0 };
    }

    let toalPrice = 0
    items.forEach(item => {
        const currentItemPrice = parseFloat(item.model_price) * parseFloat(item.quantity)
        item.item_price = currentItemPrice
        toalPrice = toalPrice + currentItemPrice
    })

    // 取得購物車內商品的圖片
    const productIds = items.map(item => item.product_id);
    const [images] = await pool.query(
        `SELECT product_id, MIN(product_img) AS product_img 
     FROM product_img 
     WHERE product_id IN (?) 
     GROUP BY product_id`,
        [productIds]
    );

    // 組合商品資料
    const itemsWithImages = items.map(item => {
        const productImage = images.find(image => image.product_id === item.product_id);
        return {
            ...item,
            product_img: productImage?.product_img || null // 若無圖片則返回 null
        };
    });

    return {
        cart_id,
        cart_items: itemsWithImages,
        total_price: toalPrice
    }
}

module.exports = {
    getCartData
}
