const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const path = require('path');
const db = require('./database');
const fs = require('fs');
const port = 3000;
const app = express();
app.use(express.json());
const sessionTables = {};

const categories = JSON.parse(fs.readFileSync('./categories.json', 'utf8'));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage: storage });

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'upload.html'));
});

app.post('/upload', upload.single('excel'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const worksheet = workbook.getWorksheet(1);

    const tableName = createTableName(req.file.originalname);
    const headers = worksheet.getRow(1).values;
    await createTable(tableName, headers);

    let validationErrors = [];
    let correctnessErrors = [];

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        const productArray = [null, ...row.values];
        const mainCategory = productArray[3]; // Adjust the index if necessary
        const categoryAttributes = categories[mainCategory];
    
        if (!categoryAttributes) {
            console.log(`Invalid main_category '${mainCategory}' at row ${rowNumber}.`);
            validationErrors.push({
                row: rowNumber,
                errors: [`Invalid main_category '${mainCategory}' at cell C${rowNumber}.`]
            });
            continue; // Skip further processing for this row
        }
    
        const product = productToObject(productArray, categoryAttributes, headers, rowNumber);
        let errors = validateRequiredAttributes(product, categoryAttributes, rowNumber);
        
        // Call validateRow and capture returned errors
        let validationResult = validateRow(product);

        if (validationResult.errors.length > 0) {
            correctnessErrors.push({ row: rowNumber, errors: validationResult.errors });
        }
        
        if (errors.length > 0) {
            validationErrors.push({ row: rowNumber, errors });
        }
    
        let flatProduct = flattenProduct(product);
        flatProduct.score = validationResult.score; // Add score to the product for insertion
    
        // Insert product into table, including the score
        await insertIntoTable(tableName, flatProduct);
    }

    const sessionId = req.sessionID || Math.random().toString(36).substring(2, 15);
    sessionTables[sessionId] = tableName;
    res.json({
        isValid: validationErrors.length === 0 && correctnessErrors.length === 0,
        message: validationErrors.length > 0 || correctnessErrors.length > 0 ? "Validation errors found" : "File uploaded and processed successfully",
        validationErrors: validationErrors,
        correctnessErrors: correctnessErrors,
        filePath: req.file.path,
        tableName: tableName,
        sessionId: sessionId  // Send this back to the client
    });
});

// Function to get product data by ID from the database
async function getProductById(tableName, id) {
    const query = `SELECT *, score FROM \`${tableName}\` WHERE id = ?`;
    const connection = await db.getConnection();
    try {
      const [product] = await connection.execute(query, [id]);
      return product;
    } catch (error) {
      console.error(`Error fetching product with ID ${id}: ${error}`);
      throw error;
    } finally {
      connection.release(); // Don't forget to release the connection
    }
}
  
  
app.post('/submit-corrections', async (req, res) => {
    const { corrections, sessionId } = req.body;
    const tableName = sessionTables[sessionId];
    if (!tableName) {
        return res.status(400).json({ message: 'Session ID is invalid or expired.' });
    }
    try {
        const headers = await getHeadersFromTable(tableName);

        for (const correction of corrections) {
            const { cell, row, newValue } = correction;
            if (!cell || cell.length < 2) { // Validate cell format minimally
                console.error(`Invalid cell format: ${cell}`);
                continue; // Skip to next correction
            }
            const columnNameIndex = cell.charCodeAt(0) - 65; // Convert column letter to index
            if (columnNameIndex < 0 || columnNameIndex >= headers.length) {
                console.error(`Cell column out of range: ${cell}`);
                continue; // Skip to next correction
            }
            const columnName = headers[columnNameIndex];

            // Update cell value in the database
            console.log(`Updating cell ${cell} in table ${tableName} with new value '${newValue}'...`);
            await updateCellValue(tableName, columnName, row - 1, newValue); // Subtract 1 from the row number to align with database IDs if necessary
        }
        // Send success response after all corrections are processed
        res.json({ message: 'Corrections updated and validated successfully.' });
    } catch (error) {
        // Handle errors
        console.error('An error occurred while updating corrections:', error);
        res.status(500).json({ message: 'An error occurred while updating corrections.', error: error.message });
    }
});



  
  
  async function updateCellValue(tableName, columnName, row, newValue) {
    const updateQuery = `UPDATE \`${tableName}\` SET \`${columnName}\` = ? WHERE id = ?`;
    try {
      await db.query(updateQuery, [newValue, row]);
      console.log(`Updated ${columnName} at row ${row} with value '${newValue}'`);
    } catch (error) {
      console.error(`Error updating cell: ${error}`);
      throw error;
    }
  }

  async function getHeadersFromTable(tableName) {
    const query = `SHOW COLUMNS FROM \`${tableName}\`;`;
    try {
      const [columns] = await db.execute(query);
      // Extract the field names from the columns
      const headers = columns.map(column => column.Field);
      return headers;
    } catch (error) {
      console.error(`Error getting headers from table '${tableName}': ${error}`);
      throw error;
    }
  }
  

  async function updateProductScore(tableName, row, score) {
    const updateScoreQuery = `UPDATE \`${tableName}\` SET \`score\` = ? WHERE id = ?`;
    try {
      await db.query(updateScoreQuery, [score, row]);
      console.log(`Updated score for row ${row} with value '${score}'`);
    } catch (error) {
      console.error(`Error updating score: ${error}`);
      throw error;
    }
}
  

function createTableName(filename) {
    const baseName = path.basename(filename, path.extname(filename));
    return baseName.replace(/[^a-zA-Z0-9_]/g, '_');
}

async function createTable(tableName, headers) {
    const sanitizedHeaders = headers.map(header => `\`${sanitizeColumnName(header)}\` TEXT`).filter(header => header !== '`` TEXT');
    sanitizedHeaders.push('`score` FLOAT');
    const columnDefinitions = ['`id` INT AUTO_INCREMENT PRIMARY KEY', ...sanitizedHeaders].join(', ');
    const createTableQuery = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (${columnDefinitions})`;
  
    try {
        await db.query(createTableQuery);
        console.log(`Table ${tableName} created or already exists.`);
    } catch (err) {
        
        console.error('Error creating table:', err.message);
        throw err;
    }
  }
  

async function insertIntoTable(tableName, rowData) {
  const columns = Object.keys(rowData).map(key => `\`${key}\``).join(', ');
  const values = Object.values(rowData).map(value => {
    if (value === null) {
      return 'NULL';
    } else if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`;
    } else if (typeof value === 'number') {
      return value;
    } else if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
  }).join(', ');

  const insertQuery = `INSERT INTO \`${tableName}\` (${columns}) VALUES (${values})`;
  await db.query(insertQuery);
}

function sanitizeColumnName(columnName) {
    return columnName.replace(/^[^a-zA-Z_]+|[^a-zA-Z0-9_]/g, "_");
}

function productToObject(productArray, categoryAttributes, headers, rowNumber) {
    const productObject = {};

    // Assuming the first element of productArray is not used (ExcelJS starts at 1, not 0)
    // Adjust the index by reducing it by 1 to align with zero-based array indexing
    headers.forEach((header, index) => {
        let adjustedIndex = index + 1; // Adjust the index for zero-based arrays
        let rawValue = productArray[adjustedIndex]; // Access the correct index in productArray
        let value = rawValue ? rawValue.toString().trim() : null;
        if (value === 'na' || value === '') value = null;

        // Check if the value is not null and if it's an object with the 'text' property
        if (value !== null && typeof value === 'object' && value.hasOwnProperty('text')) {
            // Extract the string value from the object
            value = value.text;
        }

        if (value !== null && categoryAttributes[header]) {
            switch (categoryAttributes[header].type) {
                case 'number':
                    value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                    break;
                case 'boolean':
                    value = value.toLowerCase() === 'yes' ? true : value.toLowerCase() === 'no' ? false : null;
                    break;
                case 'string':
                    break;
                case 'date':
                    const parsedDate = Date.parse(value);
                    value = !isNaN(parsedDate) ? new Date(parsedDate) : null;
                    break;
                case 'integer':
                    const parsedInt = parseInt(value, 10);
                    value = !isNaN(parsedInt) ? parsedInt : null;
                    break;
                default:
                    break;
            }
        }

        // Save the value in the product object
        productObject[header] = { value, cell: `${String.fromCharCode(65 + adjustedIndex - 1)}${rowNumber}` };
    });

    return productObject;
}




function validateRequiredAttributes(product, categoryAttributes, rowNumber) {
    let errors = [];
    // Iterate over each category attribute to check requirements
    Object.entries(categoryAttributes).forEach(([attribute, config]) => {
        const value = product[attribute]?.value;
        const type = typeof value;
        // Check if the attribute is required and missing or incorrectly typed
        if (config.required && (value === null || value === 'na')) {
            errors.push(`Missing required value for '${attribute}' in row ${rowNumber}.`);
            console.log(`Missing required value for '${attribute}' in row ${rowNumber}.`)
        } else if (config.type === 'number' && type !== 'number') {
            if (value !== null) { // Only log type mismatch if the value is not null
                errors.push(`Incorrect type for '${attribute}' in row ${rowNumber}. Expected number, got ${type}.`);
                console.log(`Incorrect type for '${attribute}' in row ${rowNumber}. Expected number, got ${type}.`)
            }
        } // Add similar checks for other types as necessary
    });
    return errors;
}


function flattenProduct(product) {
    let flatProduct = {};
    Object.entries(product).forEach(([key, attr]) => {
        // Assume each attribute of product is an object with 'value' and possibly other properties like 'cell'
        // We only want to keep the 'value' for database insertion
        flatProduct[key] = attr.value;
    });
    return flatProduct;
}

function validateRow(product) {
    const errors = [];
    let score = 0; // Initialize score
    Object.entries(product).forEach(([attribute, { value, cell }]) => {
        if (value === null) return;
        switch(attribute) {
            case 'name':
                if (!value || typeof value !== 'string' || value.length > 50 || !/^[a-zA-Z]/.test(value) || /[^a-zA-Z0-9 ]/.test(value)) {
                    errors.push(`Invalid 'name' at cell ${cell}: '${value}'. Must be less than 50 characters, no special characters, and cannot start with numerals.`);
                    // console.log(`Invalid 'name' at cell ${cell}: '${value}'. Must be less than 50 characters, no special characters, and cannot start with numerals.`);
                } else {
                    score += 10;
                }
                break;
            case 'main_category':
                if (!value || typeof value !== 'string') {
                    errors.push(`Invalid 'main_category' at cell ${cell}: '${value}'. Must be a valid category.`);
                } else {
                    score += 10;
                }
                break;
            case 'sub_category':
                // Similar to 'main_category', ensure 'sub_category' is valid
                if (!value || typeof value !== 'string') {
                    errors.push(`Invalid 'sub_category' at cell ${cell}: '${value}'.`);
                } else {
                    score += 10;
                }
                break;
            case 'image':
                // Example validation might check if the value looks like a URL
                if (!value || typeof value !== 'string' || !value.startsWith('http')) {
                    errors.push(`Invalid 'image' URL at cell ${cell}: '${value}'. Must be a valid URL.`);
                } else {
                    score += 10;
                }
                break;
            case 'link':
                if (!value || typeof value !== 'string' || !value.startsWith('http')) {
                    errors.push(`Invalid 'link' URL at cell ${cell}: '${value}'. Must be a valid URL.`);
                } else {
                    score += 10;
                }
                break;
            case 'ratings':
                // Assuming ratings should be a number between 0 and 5
                if (isNaN(value) || value < 0 || value > 5) {
                    errors.push(`Invalid 'ratings' at cell ${cell}: '${value}'. Must be a number between 0 and 5.`);
                } else {
                    score += 10;
                }
                break;
            case 'no_of_ratings':
                // Assuming a positive number
                if (isNaN(value) || value < 0) {
                    errors.push(`Invalid 'no_of_ratings' at cell ${cell}: '${value}'. Must be a positive number.`);
                } else {
                    score += 10;
                }
                break;
            case 'discount_price':
                // Assuming a non-negative number, discount price should logically be less than actual price, but that's not validated here
                if (isNaN(value) || value < 0) {
                    errors.push(`Invalid 'discount_price' at cell ${cell}: '${value}'. Must be a non-negative number.`);
                } else {
                    score += 10;
                }
                break;
            case 'actual_price':
                // Assuming a non-negative number
                if (isNaN(value) || value < 0) {
                    errors.push(`Invalid 'actual_price' at cell ${cell}: '${value}'. Must be a non-negative number.`);
                } else {
                    score += 10;
                }
                break;
            case 'Extended_Warranty_Years':
                if (isNaN(value) || value < 0 || value > 2) {
                    errors.push(`Invalid 'Extended_Warranty_Years' at cell ${cell}: '${value}'. Must be between 0 and 2.`);
                } else {
                    score += 10;
                }
                break;
            case 'Basic_Warranty_Years':
                if (isNaN(value) || value < 0 || value > 1) {
                    errors.push(`Invalid 'Basic_Warranty_Years' at cell ${cell}: '${value}'. Must be between 0 and 1.`);
                } else {
                    score += 10;
                }
                break;
            case 'Date_of_manufacturing':
                if (!value || isNaN(Date.parse(value))) {
                    errors.push(`Invalid 'Date_of_manufacturing' at cell ${cell}: '${value}'. Must be a valid date.`);
                } else {
                    score += 10;
                }
                break;
            case 'Variants':
                if (!value || typeof value !== 'string') {
                    errors.push(`Invalid 'Variants' at cell ${cell}: '${value}'.`);
                } else {
                    score += 10;
                }
                break;
            case 'Certification_Verification':
                if (value !== true && value !== false) {
                    errors.push(`Invalid 'Certification_Verification' at cell ${cell}: '${value}'. Must be 'Yes' or 'No'.`);
                } else {
                    score += 10;
                }
                break;
            case 'Availability':
                if (value !== true && value !== false) {
                    errors.push(`Invalid 'Availability' at cell ${cell}: '${value}'. Must be 'Yes' or 'No'.`);
                } else {
                    score += 10;
                }
                break;
            case 'Expiry_Date':
                if (!value || isNaN(Date.parse(value))) {
                    errors.push(`Invalid 'Expiry_Date' at cell ${cell}: '${value}'. Must be a valid date.`);
                } else {
                    score += 10;
                }
                break;
            case 'Color':
                if (!value || typeof value !== 'string') {
                    errors.push(`Invalid 'Color' at cell ${cell}: '${value}'.`);
                } else {
                    score += 10;
                }
                break;
            case 'Brand_Value':
                if (isNaN(value) || value < 0) {
                    errors.push(`Invalid 'Brand_Value' at cell ${cell}: '${value}'. Must be a positive number.`);
                } else {
                    score += 10;
                }
                break;
            case 'Size':
                if (isNaN(value) && typeof value !== 'string') {
                    errors.push(`Invalid 'Size' at cell ${cell}: '${value}'. Must be a valid size.`);
                } else {
                    score += 10;
                }
                break;
            case 'Nutrients':
                if (!value || typeof value !== 'string') {
                    errors.push(`Invalid 'Nutrients' at cell ${cell}: '${value}'.`);
                } else {
                    score += 10;
                }
                break;
            case 'Quantity':
                if (isNaN(value) || value < 0) {
                    errors.push(`Invalid 'Quantity' at cell ${cell}: '${value}'. Must be a positive number.`);
                } else {
                    score += 10;
                }
                break;
            case 'Age_recommendition':
                if (!value || typeof value !== 'string') {
                    errors.push(`Invalid 'Age_recommendition' at cell ${cell}: '${value}'.`);
                } else {
                    score += 10;
                }
                break;
            case 'Sales_Last_30_Days':
                if (isNaN(value) || value < 0) {
                    errors.push(`Invalid 'Sales_Last_30_Days' at cell ${cell}: '${value}'. Must be a non-negative number.`);
                } else {
                    score += 10;
                }
                break;
            case 'Number_of_Outlets':
                if (isNaN(value) || value < 0) {
                    errors.push(`Invalid 'Number_of_Outlets' at cell ${cell}: '${value}'. Must be a non-negative number.`);
                } else {
                    score += 10;
                }
                break;
            case 'Searches_Last_30_Days':
                if (isNaN(value) || value < 0) {
                    errors.push(`Invalid 'Searches_Last_30_Days' at cell ${cell}: '${value}'. Must be a non-negative number.`);
                } else {
                    score += 10;
                }
                break;
            case 'Advertisement_Channels':
                if (!value || typeof value !== 'string') {
                    errors.push(`Invalid 'Advertisement_Channels' at cell ${cell}: '${value}'.`);
                } else {
                    score += 10;
                }
                break;
            case 'material':
                if (!value || typeof value !== 'string') {
                    errors.push(`Invalid 'material' at cell ${cell}: '${value}'.`);
                } else {
                    score += 10;
                }
                break;
            case 'Gender':
                if (value !== 'Male' && value !== 'Female') {
                    errors.push(`Invalid 'Gender' at cell ${cell}: '${value}'. Must be 'Male' or 'Female'.`);
                } else {
                    score += 10;
                }
                break;
        }
    });

    return {
        isValid: errors.length === 0,
        errors: errors,
        score: score 
    };
}



app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});