const mysql = require('mysql2/promise');

// Create a connection pool
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'Raunak#6677',
  database: 'raunak'
});

// Asynchronously check the connection
async function checkConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('Connected to database with ID ' + connection.threadId);
    connection.release();
  } catch (err) {
    console.error('Error connecting to the database:', err);
  }
}

// Call the function to check the connection
checkConnection();

module.exports = pool;
