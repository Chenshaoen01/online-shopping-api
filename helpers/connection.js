const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.MY_SQL_PATH,
    port: process.env.MY_SQL_PORT,
    user: process.env.MY_SQL_USER_NAME,
    password: process.env.MY_SQL_PQSSWORD,
    database: process.env.MY_SQL_DB_NAME
  });

module.exports = pool;