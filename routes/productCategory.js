const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { verifyJWT, verifyAdmin } = require("@middlewares/auth")
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MY_SQL_PATH,
  user: process.env.MY_SQL_USER_NAME,
  password: process.env.MY_SQL_PQSSWORD,
  database: process.env.MY_SQL_DB_NAME
});

// 分頁查詢 category（每頁10筆）
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM product_category`);
    const lastPage = Math.ceil(total / limit);

    let startPage = Math.max(1, page - 2);
    let endPage = Math.min(lastPage, page + 2);
    if (endPage - startPage < 4) {
      if (startPage === 1) {
        endPage = Math.min(lastPage, startPage + 4);
      } else if (endPage === lastPage) {
        startPage = Math.max(1, endPage - 4);
      }
    }

    const pageList = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
    const [categories] = await pool.query(
      `SELECT * FROM product_category ORDER BY category_id LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.json({ dataList: categories, lastPage, pageList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 取得指定類別的產品
router.get('/getCategoryProduct', async (req, res) => {
  const category_id = req.query.category_id || null;
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;
  
  try {
    // 計算符合條件的產品總數
    const countQuery = category_id
      ? `SELECT COUNT(*) AS total FROM product WHERE category_id = ? AND is_active = 1`
      : `SELECT COUNT(*) AS total FROM product WHERE is_active = 1`;
    const countParams = category_id ? [category_id] : [];
    const [[{ total }]] = await pool.query(countQuery, countParams);

    if (total === 0) {
      return res.json({ dataList: [], lastPage: 0, pageList: [] });
    }

    // 計算頁數
    const lastPage = Math.ceil(total / limit);

    let startPage = Math.max(1, page - 2);
    let endPage = Math.min(lastPage, page + 2);

    if (endPage - startPage < 4) {
      if (startPage === 1) {
        endPage = Math.min(lastPage, startPage + 4);
      } else if (endPage === lastPage) {
        startPage = Math.max(1, endPage - 4);
      }
    }

    const pageList = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);

    // 查詢符合條件的產品
    const productQuery = category_id
      ? `SELECT p.*, c.category_name 
         FROM product p
         LEFT JOIN product_category c ON p.category_id = c.category_id
         WHERE p.category_id = ? AND p.is_active = 1
         ORDER BY p.product_id
         LIMIT ? OFFSET ?`
      : `SELECT p.*, c.category_name 
         FROM product p
         LEFT JOIN product_category c ON p.category_id = c.category_id
         WHERE p.is_active = 1
         ORDER BY p.product_id
         LIMIT ? OFFSET ?`;
    const productParams = category_id ? [category_id, limit, offset] : [limit, offset];
    const [products] = await pool.query(productQuery, productParams);

    if (products.length === 0) {
      return res.json({ dataList: [], lastPage, pageList });
    }

    // 查詢產品的相關 model 和圖片
    const productIds = products.map(product => product.product_id);

    const [models] = await pool.query(
      `SELECT * FROM model WHERE product_id IN (?)`,
      [productIds]
    );

    const [images] = await pool.query(
      `SELECT product_id, MIN(product_img) AS product_img 
       FROM product_img 
       WHERE product_id IN (?)
       GROUP BY product_id`,
      [productIds]
    );

    // 組合產品資料
    const productWithDetails = products.map(product => {
      const productModels = models.filter(model => model.product_id === product.product_id);
      const productImage = images.find(image => image.product_id === product.product_id);

      // 計算 product_price
      const modelPrices = productModels.map(model => model.model_price).filter(price => price !== null);
      let productPrice = null;
      if (modelPrices.length === 1) {
        productPrice = modelPrices[0];
      } else if (modelPrices.length > 1) {
        const minPrice = Math.min(...modelPrices);
        const maxPrice = Math.max(...modelPrices);
        productPrice = minPrice === maxPrice ? minPrice : `${minPrice} - ${maxPrice}`;
      }

      return {
        ...product,
        is_active: product.is_active === 1 ? "是" : "否",
        product_img: productImage?.product_img,
        product_price: productPrice
      };
    });

    const categoryData = {
      category_id: category_id,
      category_name: (Array.isArray(productWithDetails) && productWithDetails.length > 0) ? productWithDetails[0].category_name : ""
    }

    // 回傳結果
    res.json({categoryData, dataList: productWithDetails, lastPage, pageList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 查詢全部 categories
router.get('/getAll', async (req, res) => {
  try {
    const [categories] = await pool.query(`SELECT * FROM product_category ORDER BY category_id`);
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 根據 category_id 查詢特定 category
router.get('/:category_id', async (req, res) => {
  const { category_id } = req.params;

  try {
    const [category] = await pool.query(
      `SELECT * FROM product_category WHERE category_id = ?`,
      [category_id]
    );

    if (category.length === 0) {
      return res.status(404).json({ message: '找不到對應的商品類別' });
    }

    res.json(category[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新增 category
router.post('/', verifyJWT, verifyAdmin, async (req, res) => {
  const { category_id, category_name } = req.body;

  if (!category_id || !category_name) {
    return res.status(400).json({ message: '類別編號及類別名稱為必填項目' });
  }

  try {
    const [existingCategory] = await pool.query(
      `SELECT * FROM product_category WHERE category_id = ?`,
      [category_id]
    );

    if (existingCategory.length > 0) {
      return res.status(400).json({ message: '類別編號已被使用' });
    }
    
    await pool.query(
      `INSERT INTO product_category (category_id, category_name) VALUES (?, ?)`,
      [category_id, category_name]
    );

    res.status(201).json({ message: '商品類別新增成功', category_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 修改 category_name
router.put('/:category_id', verifyJWT, verifyAdmin, async (req, res) => {
  const { category_id } = req.params;
  const { category_name } = req.body;

  if (!category_name) {
    return res.status(400).json({ message: '類別名稱為必填項目' });
  }

  try {
    const [result] = await pool.query(
      `UPDATE product_category SET category_name = ? WHERE category_id = ?`,
      [category_name, category_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '找不到對應的商品類別' });
    }

    res.json({ message: '商品類別更新成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 刪除 categories
router.delete('/', verifyJWT, verifyAdmin, async (req, res) => {
    const { category_ids } = req.body;
  
    if (!Array.isArray(category_ids) || category_ids.length === 0) {
      return res.status(400).json({ message: '須提供欲刪除的類別編號' });
    }
  
    try {
      // 檢查是否有產品與這些 category_id 關聯
      const [relatedProducts] = await pool.query(
        `SELECT DISTINCT category_id FROM product WHERE category_id IN (?)`,
        [category_ids]
      );
  
      if (relatedProducts.length > 0) {
        const relatedCategoryIds = relatedProducts.map((product) => product.category_id);
        return res.status(400).json({
          error: '商品類別已被使用，無法刪除',
          relatedCategoryIds,
        });
      }
  
      // 如果沒有關聯產品，執行刪除
      const [result] = await pool.query(
        `DELETE FROM product_category WHERE category_id IN (?)`,
        [category_ids]
      );
  
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: '找不到對應的商品類別' });
      }
  
      res.json({ message: '商品類別刪除成功' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

module.exports = router;
