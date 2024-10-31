const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const upload = multer({ dest: 'public/images/product' });
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MY_SQL_PATH,
  user: process.env.MY_SQL_USER_NAME,
  password: process.env.MY_SQL_PQSSWORD,
  database: process.env.MY_SQL_DB_NAME
});

// 產品查詢（每頁10筆，依頁數顯示，並附帶產品型號）
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    // 查詢產品資料
    const [products] = await pool.query(
      `SELECT * FROM product LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // 如果沒有產品，直接回傳空陣列
    if (products.length === 0) {
      return res.json({ data: [] });
    }

    // 收集產品ID
    const productIds = products.map(product => product.product_id);

    // 查詢對應的產品型號資料
    const [models] = await pool.query(
      `SELECT * FROM model WHERE product_id IN (?)`,
      [productIds]
    );

    // 查詢對應的產品圖片資料
    const [images] = await pool.query(
      `SELECT * FROM product_img WHERE product_id IN (?)`,
      [productIds]
    );

    // 將產品型號和圖片按 product_id 分組
    const productWithDetails = products.map(product => {
      const productModels = models.filter(model => model.product_id === product.product_id);
      const productImages = images.filter(image => image.product_id === product.product_id);

      return {
        ...product,
        models: productModels,
        images: productImages
      };
    });

    res.json({ data: productWithDetails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 依據 product_id 取回特定產品資料 API
router.get('/:product_id', async (req, res) => {
  const { product_id } = req.params;

  try {
    // 查詢 product 資料
    const [product] = await pool.query(
      `SELECT * FROM product WHERE product_id = ?`,
      [product_id]
    );

    if (product.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // 查詢 model 資料
    const [models] = await pool.query(
      `SELECT * FROM model WHERE product_id = ?`,
      [product_id]
    );

    // 查詢 product_img 資料
    const [images] = await pool.query(
      `SELECT * FROM product_img WHERE product_id = ?`,
      [product_id]
    );

    res.json({
      product: product[0],
      models: models,
      images: images
    });
  } catch (err) {
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

// productImg 新增
router.post('/productImg', productUpload.single('productImg'), async (req, res) => {
  try {
    res.status(201).json({ message: 'Product image added successfully', productFileName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 產品新增 API
router.post('/', async (req, res) => {
  const { product_name, product_info, is_active, models, images } = req.body;
  const product_id = uuidv4();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 插入 product 資料
    await connection.query(
      `INSERT INTO product (product_id, product_name, product_info, is_active) VALUES (?, ?, ?, ?)`,
      [product_id, product_name, product_info, parseInt(is_active)]
    );

    // 插入 model 資料
    for (const model of models) {
      const model_id = model.model_id || uuidv4(); // 使用傳入的 model_id，若無則生成新的 UUID
      await connection.query(
        `INSERT INTO model (model_id, model_name, model_price, model_quantity, product_id) 
         VALUES (?, ?, ?, ?, ?)`,
        [model_id, model.model_name, model.model_price, model.model_quantity, product_id]
      );
    }

    // 插入 product_img 資料
    for (const image of images) {
      if (image.state === "Added") {
        const product_img_id = uuidv4(); // 生成新的 UUID
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
router.put('/:product_id', async (req, res) => {
  const { product_id } = req.params;
  const { product_name, product_info, is_active, models, images } = req.body;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 更新 product 資料
    await connection.query(
      `UPDATE product SET product_name = ?, product_info = ?, is_active = ? WHERE product_id = ?`,
      [product_name, product_info, is_active, product_id]
    );

    // 更新 model 資料
    // 先刪除原有的 model 資料
    await connection.query(`DELETE FROM model WHERE product_id = ?`, [product_id]);

    // 插入新的 model 資料
    for (const model of models) {
      const model_id = model.model_id || uuidv4(); // 使用傳入的 model_id，若無則生成新的 UUID
      await connection.query(
        `INSERT INTO model (model_id, model_name, model_price, model_quantity, product_id) 
         VALUES (?, ?, ?, ?, ?)`,
        [model_id, model.model_name, model.model_price, model.model_quantity, product_id]
      );
    }

    // 更新 product_img 資料
    for (const image of images) {
      const filePath = path.join(__dirname, '../public/images/product', image.product_img);

      if (image.state === "Added") {
        // 新增圖片
        const product_img_id = uuidv4();
        await connection.query(
          `INSERT INTO product_img (product_img_id, product_id, product_img) 
           VALUES (?, ?, ?)`,
          [product_img_id, product_id, image.product_img]
        );
      } else if (image.state === "Deleted") {
        // 刪除圖片檔案
        fs.unlink(filePath, (err) => {
          if (err) console.error(`Error deleting file ${image.product_img}:`, err);
        });

        // 刪除圖片資料
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

// 產品刪除 API
router.delete('/:product_id', async (req, res) => {
  const { product_id } = req.params;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 查找與該產品相關的所有圖片
    const [productImages] = await connection.query(
      `SELECT product_img FROM product_img WHERE product_id = ?`, 
      [product_id]
    );

    // 刪除 product_img 資料
    await connection.query(`DELETE FROM product_img WHERE product_id = ?`, [product_id]);

    // 刪除 model 資料
    await connection.query(`DELETE FROM model WHERE product_id = ?`, [product_id]);

    // 刪除 product 資料
    await connection.query(`DELETE FROM product WHERE product_id = ?`, [product_id]);

    // 刪除對應的圖片檔案
    for (const image of productImages) {
      const filePath = path.join(__dirname, '../public/images/product', image.product_img);
      fs.unlink(filePath, (err) => {
        if (err) console.error(`Error deleting file ${image.product_img}:`, err);
      });
    }

    await connection.commit();
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
