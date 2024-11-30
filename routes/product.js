const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { verifyJWT, verifyAdmin } = require('@middlewares/auth')
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MY_SQL_PATH,
  user: process.env.MY_SQL_USER_NAME,
  password: process.env.MY_SQL_PQSSWORD,
  database: process.env.MY_SQL_DB_NAME
});

// 產品查詢（每頁10筆，依頁數顯示，並附帶產品型號與類別名稱）
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM product`);
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

    const [products] = await pool.query(
      `SELECT p.*, c.category_name 
       FROM product p
       LEFT JOIN product_category c ON p.category_id = c.category_id
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    if (products.length === 0) {
      return res.json({ dataList: [], lastPage, pageList });
    }

    const productIds = products.map(product => product.product_id);

    const [models] = await pool.query(
      `SELECT * FROM model WHERE product_id IN (?)`,
      [productIds]
    );

    const [images] = await pool.query(
      `SELECT * FROM product_img WHERE product_id IN (?)`,
      [productIds]
    );

    const productWithDetails = products.map(product => {
      const productModels = models.filter(model => model.product_id === product.product_id);
      const productImages = images.filter(image => image.product_id === product.product_id);

      // 計算 product_quantity
      const productQuantity = productModels.reduce((sum, model) => sum + parseFloat(model.model_quantity || 0), 0);

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
        models: productModels,
        images: productImages,
        product_quantity: productQuantity,
        product_price: productPrice
      };
    });

    res.json({ dataList: productWithDetails, lastPage, pageList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 取得推薦商品
router.get('/getRecommendedProducts', async (req, res) => {
  try {
    // 查詢前四筆推薦商品
    const query = `
      SELECT p.*, c.category_name, MIN(img.product_img) AS product_img
      FROM product p
      LEFT JOIN product_category c ON p.category_id = c.category_id
      LEFT JOIN product_img img ON p.product_id = img.product_id
      WHERE p.is_recommended = 1 AND p.is_active = 1
      GROUP BY p.product_id
      ORDER BY p.product_id
      LIMIT 6
    `;

    const [products] = await pool.query(query);

    if (products.length === 0) {
      return res.json({ dataList: [] });
    }

    // 查詢相關的 model 資訊
    const productIds = products.map(product => product.product_id);

    const [models] = await pool.query(
      `SELECT * FROM model WHERE product_id IN (?)`,
      [productIds]
    );

    // 組合產品資料
    const recommendedProducts = products.map(product => {
      const productModels = models.filter(model => model.product_id === product.product_id);

      // 計算 product_quantity
      const productQuantity = productModels.reduce((sum, model) => sum + parseFloat(model.model_quantity || 0), 0);

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
        product_img: product.product_img,
        product_quantity: productQuantity,
        product_price: productPrice
      };
    });
    console.log(recommendedProducts)
    // 回傳結果
    res.json(recommendedProducts);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

// 依據 product_id 取回特定產品資料 API
router.get('/:product_id', async (req, res) => {
  const { product_id } = req.params;

  try {
    const [product] = await pool.query(
      `SELECT * FROM product WHERE product_id = ?`,
      [product_id]
    );

    if (product.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const [models] = await pool.query(
      `SELECT * FROM model WHERE product_id = ?`,
      [product_id]
    );

    const [images] = await pool.query(
      `SELECT * FROM product_img WHERE product_id = ?`,
      [product_id]
    );

    res.json({
      ...product[0],
      models: models,
      images: images
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 依據產品ID取得相同類別的產品
router.get('/related/:product_id', async (req, res) => {
  const { product_id } = req.params;

  try {
    // 查詢該產品的類別ID
    const [product] = await pool.query(
      `SELECT category_id FROM product WHERE product_id = ?`,
      [product_id]
    );

    if (product.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const { category_id } = product[0];

    // 查詢相同類別的產品，排除自身產品，限制最多6筆
    const [relatedProducts] = await pool.query(
      `SELECT p.*, c.category_name 
       FROM product p
       LEFT JOIN product_category c ON p.category_id = c.category_id
       WHERE p.category_id = ? AND p.product_id != ? AND p.is_active = 1
       ORDER BY p.product_id
       LIMIT 6`,
      [category_id, product_id]
    );

    if (relatedProducts.length === 0) {
      return res.json({ dataList: [] });
    }

    // 取得相關產品的 model 和圖片
    const relatedProductIds = relatedProducts.map(product => product.product_id);

    const [models] = await pool.query(
      `SELECT * FROM model WHERE product_id IN (?)`,
      [relatedProductIds]
    );

    const [images] = await pool.query(
      `SELECT product_id, MIN(product_img) AS product_img 
       FROM product_img 
       WHERE product_id IN (?)
       GROUP BY product_id`,
      [relatedProductIds]
    );

    // 組合相關產品資料
    const relatedProductsWithDetails = relatedProducts.map(product => {
      const productModels = models.filter(model => model.product_id === product.product_id);
      const productImage = images.find(image => image.product_id === product.product_id);

      // 計算 product_quantity
      const productQuantity = productModels.reduce((sum, model) => sum + parseFloat(model.model_quantity || 0), 0);

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
        product_quantity: productQuantity,
        product_price: productPrice
      };
    });

    res.json(relatedProductsWithDetails);
  } catch (err) {
    console.log(err.message);
    res.status(500).json({ error: err.message });
  }
});

// 產品圖片上傳
let productFileName = "";
const productStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/images/product");
  },
  filename: function (req, file, cb) {
    const fileExtensionPattern = /\.([0-9a-z]+)(?=[?#])|(\.)(?:[\w]+)$/;
    const extension = file.originalname.match(fileExtensionPattern)[0];
    productFileName = file.fieldname + "-" + Date.now() + extension;
    cb(null, productFileName);
  },
});

const productUpload = multer({ storage: productStorage });

router.post('/productImg', verifyJWT, verifyAdmin, productUpload.single('productImg'), async (req, res) => {
  try {
    res.status(201).json({ message: 'Product image added successfully', productFileName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 產品新增 API
router.post('/', verifyJWT, verifyAdmin, async (req, res) => {
  const { product_name, product_info, is_active, is_recommended, category_id, models, images } = req.body;
  const product_id = uuidv4();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query(
      `INSERT INTO product (product_id, product_name, product_info, is_active, is_recommended, category_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [product_id, product_name, product_info, parseInt(is_active), parseInt(is_recommended), category_id]
    );

    for (const model of models) {
      const model_id = model.model_id || uuidv4();
      await connection.query(
        `INSERT INTO model (model_id, model_name, model_price, model_quantity, product_id) 
         VALUES (?, ?, ?, ?, ?)`,
        [model_id, model.model_name, model.model_price, model.model_quantity, product_id]
      );
    }

    for (const image of images) {
      if (image.state === "Added") {
        const product_img_id = uuidv4();
        await connection.query(
          `INSERT INTO product_img (product_img_id, product_id, product_img) 
           VALUES (?, ?, ?)`,
          [product_img_id, product_id, image.product_img]
        );
      }
    }

    await connection.commit();
    res.status(201).json({ message: 'Product added successfully', product_id });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 產品修改 API
router.put('/:product_id', verifyJWT, verifyAdmin, async (req, res) => {
  const { product_id } = req.params;
  const { product_name, product_info, is_active, is_recommended, category_id, models, images } = req.body;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query(
      `UPDATE product SET product_name = ?, product_info = ?, is_active = ?, is_recommended = ?, category_id = ? 
       WHERE product_id = ?`,
      [product_name, product_info, is_active, is_recommended, category_id, product_id]
    );

    await connection.query(`DELETE FROM model WHERE product_id = ?`, [product_id]);

    for (const model of models) {
      const model_id = model.model_id || uuidv4();
      await connection.query(
        `INSERT INTO model (model_id, model_name, model_price, model_quantity, product_id) 
         VALUES (?, ?, ?, ?, ?)`,
        [model_id, model.model_name, model.model_price, model.model_quantity, product_id]
      );
    }

    for (const image of images) {
      const filePath = path.join(__dirname, '../public/images/product', image.product_img);

      if (image.state === "Added") {
        const product_img_id = uuidv4();
        await connection.query(
          `INSERT INTO product_img (product_img_id, product_id, product_img) 
           VALUES (?, ?, ?)`,
          [product_img_id, product_id, image.product_img]
        );
      } else if (image.state === "Deleted") {
        fs.unlink(filePath, (err) => {
          if (err) console.error(`Error deleting file ${image.product_img}:`, err);
        });

        await connection.query(
          `DELETE FROM product_img WHERE product_img_id = ? AND product_id = ?`,
          [image.product_img_id, product_id]
        );
      }
    }

    await connection.commit();
    res.json({ message: 'Product updated successfully' });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 調整產品是否上架
router.post('/update-active-status', verifyJWT, verifyAdmin, async (req, res) => {
  const { isActive, product_ids } = req.body;

  // 驗證參數
  if (![0, 1].includes(isActive)) {
    return res.status(400).json({ error: 'Invalid is_active value. Must be 0 or 1.' });
  }

  if (!Array.isArray(product_ids) || product_ids.length === 0) {
    return res.status(400).json({ error: 'Invalid product_ids array.' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 更新產品是否上架
    const [result] = await connection.query(
      `UPDATE product SET is_active = ? WHERE product_id IN (?)`,
      [isActive, product_ids]
    );

    // 驗證是否成功更新
    if (result.affectedRows === 0) {
      throw new Error('No products found or updated.');
    }

    await connection.commit();
    res.json({ message: 'Products updated successfully', affectedRows: result.affectedRows });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 刪除產品
router.delete('/', verifyJWT, verifyAdmin, async (req, res) => {
  const { product_ids } = req.body;

  if (!Array.isArray(product_ids) || product_ids.length === 0) {
    return res.status(400).json({ error: 'Invalid product_ids array' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [productImages] = await connection.query(
      `SELECT product_id, product_img FROM product_img WHERE product_id IN (?)`,
      [product_ids]
    );

    await connection.query(`DELETE FROM product_img WHERE product_id IN (?)`, [product_ids]);
    await connection.query(`DELETE FROM model WHERE product_id IN (?)`, [product_ids]);
    await connection.query(`DELETE FROM product WHERE product_id IN (?)`, [product_ids]);

    for (const image of productImages) {
      const filePath = path.join(__dirname, '../public/images/product', image.product_img);
      fs.unlink(filePath, (err) => {
        if (err) console.error(`Error deleting file ${image.product_img}:`, err);
      });
    }

    await connection.commit();
    res.json({ message: 'Products deleted successfully' });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
