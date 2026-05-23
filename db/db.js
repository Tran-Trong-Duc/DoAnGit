const mysql = require("mysql2");

const db = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "123456",
  database: process.env.DB_NAME || "iot_garden",
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
});

db.query("SELECT DATABASE()", (err, result) => {
  if (err) {
    console.log("Loi ket noi MySQL:", err.message);
  } else {
    console.log("Ket noi MySQL thanh cong:", result);
  }
});

module.exports = db;
