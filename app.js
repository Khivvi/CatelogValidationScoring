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
const validateRow = require('./validation');

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
            // When pushing main_category errors into the validationErrors array
            correctnessErrors.push({
                row: rowNumber,
                errors: [`Invalid 'main_category' at cell C${rowNumber} with value '${mainCategory}'. Must be one of: [${Object.keys(categories).join(", ")}]`]
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
  
app.post('/submit-corrections', async (req, res) => {
    const { corrections, sessionId } = req.body;
    const tableName = sessionTables[sessionId];
    if (!tableName) {
        return res.status(400).json({ message: 'Session ID is invalid or expired.' });
    }

    const connection = await db.getConnection(); // Get a connection from the pool

    try {
        await connection.beginTransaction(); // Start the transaction

        const headers = await getHeadersFromTable(connection, tableName);

        // First loop: Apply all corrections to the database
        for (const correction of corrections) {
            const { cell, row, newValue } = correction;
            if (!cell || cell.length < 2) {
                console.error(`Invalid cell format: ${cell}`);
                continue;
            }
            const columnNameIndex = cell.charCodeAt(0) - 65; // Convert column letter to index
            const columnName = headers[columnNameIndex]; // Assuming headers are in correct order

            await updateCellValue(connection, tableName, columnName, row - 1, newValue); // Pass connection
        }

        await connection.commit(); // Commit the transaction after all updates are applied

        // Second loop: Validate all rows after the updates
        let correctedRows = [];
        let validityErrors = [];
        for (const correction of corrections) {
            const { cell, row } = correction;
            const adjustedRow = row - 1; // Adjust row number for zero-based index

            const dbData = await getProductRowFromTable(connection, tableName, adjustedRow); // Pass connection
            const productForValidation = transformDbDataForValidation(dbData, headers, adjustedRow); // Now pass headers and adjusted row as well
            
            const validationResult = validateRow(productForValidation);
            if (validationResult.errors.length > 0) {
                validityErrors.push({ row: adjustedRow + 1, errors: validationResult.errors }); // Add 1 to row for display purposes
            } else {
                correctedRows.push({ row: adjustedRow, score: validationResult.score });
            }
        }

        // Update the product score for corrected rows
        for (const correctedRow of correctedRows) {
            await updateProductScore(connection, tableName, correctedRow.row, correctedRow.score); // Pass connection
        }

        let message = 'Corrections updated and validated successfully.';
        if (validityErrors.length > 0) {
            message = 'Corrections updated, but some values are still invalid.';
        }

        res.json({ message: message, validityErrors: validityErrors });
    } catch (error) {
        await connection.rollback(); // Rollback the transaction in case of an error
        console.error('An error occurred while updating corrections:', error);
        res.status(500).json({ message: 'An error occurred while updating corrections.', error: error.message });
    } finally {
        connection.release(); // Release the connection back to the pool
    }
});

// Make sure to update the other functions to accept a `connection` parameter and use it instead of `pool`.


function transformDbDataForValidation(dbData, headers, rowNumber) {
    const transformed = {};
    headers.forEach((header, index) => {
        const cell = `${String.fromCharCode(65 + index)}${rowNumber}`; // This creates a string like "A1", "B1", etc.
        transformed[header] = { value: dbData[header], cell: cell };
    });
    return transformed;
}


  
async function updateCellValue(connection, tableName, columnName, row, newValue) {
    const updateQuery = `UPDATE \`${tableName}\` SET \`${columnName}\` = ? WHERE id = ?`;
    try {
      await connection.execute(updateQuery, [newValue, row]);
      console.log(`Updated ${columnName} at row ${row} with value '${newValue}'`);
    } catch (error) {
      console.error(`Error updating cell: ${error}`);
      throw error; // Rethrow the error to handle it in the transaction block
    }
  }
  

  async function getHeadersFromTable(connection, tableName) {
    const query = `SHOW COLUMNS FROM \`${tableName}\``;
    try {
        const [columns] = await connection.execute(query);
        // Extract the field names from the columns
        const headers = columns.map(column => column.Field);
        return headers;
    } catch (error) {
        console.error(`Error getting headers from table '${tableName}': ${error}`);
        throw error;
    }
}

async function updateProductScore(connection, tableName, row, score) {
    const updateScoreQuery = `UPDATE \`${tableName}\` SET \`score\` = ? WHERE id = ?`;
    try {
        await connection.execute(updateScoreQuery, [score, row]);
        console.log(`Updated score for row ${row} with value '${score}'`);
    } catch (error) {
        console.error(`Error updating score: ${error}`);
        throw error;
    }
}


async function getProductRowFromTable(connection, tableName, rowNumber) {
    const selectQuery = `SELECT * FROM \`${tableName}\` WHERE id = ?`;
    try {
        const [rows] = await connection.execute(selectQuery, [rowNumber]);
        if (rows.length === 0) {
            throw new Error(`Row with id ${rowNumber} not found in table '${tableName}'.`);
        }
        return rows[0];
    } catch (error) {
        console.error(`Error retrieving row from table '${tableName}': ${error}`);
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

    headers.forEach((header, index) => {
        let adjustedIndex = index + 1; // Adjust the index for zero-based arrays
        let rawValue = productArray[adjustedIndex]; // Access the correct index in productArray
        let value = rawValue ? rawValue.toString().trim() : null;
        if (value === 'na' || value === '') value = null;

        // Special handling for Certification_Verification and Availability
        // to keep "Yes" or "No" values as they are
        if (header === 'Certification_Verification' || header === 'Availability') {
            // Directly assign "Yes" or "No" values without converting to boolean
            productObject[header] = { value, cell: `${String.fromCharCode(65 + adjustedIndex - 1)}${rowNumber}` };
            return; // Skip further processing for this attribute
        }

        // For other attributes, continue with the existing processing logic
        if (value !== null && categoryAttributes[header]) {
            switch (categoryAttributes[header].type) {
                case 'number':
                    value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                    break;
                case 'boolean':
                    // Since we're bypassing boolean conversion for Certification_Verification and Availability,
                    // this case will apply to other boolean attributes if any
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

        // Assign the processed value to the product object
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



app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});