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
const totalcategoryscore = JSON.parse(fs.readFileSync('./score.json', 'utf8'));
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
    totalpossiblescore = (worksheet.rowCount-1)*100;
    let totalrowscore = 0;
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        const productArray = [null, ...row.values];
        const mainCategory = productArray[3]; 
        const categoryAttributes = categories[mainCategory];
        const totalscore = totalcategoryscore[mainCategory]
        if (!categoryAttributes) {
            console.log(`Invalid main_category '${mainCategory}' at row ${rowNumber}.`);
            
            correctnessErrors.push({
                row: rowNumber,
                errors: [`Invalid 'main_category' at cell C${rowNumber} with value '${mainCategory}'. Must be one of: [${Object.keys(categories).join(", ")}]`]
            });

            continue; 
        }
    
        const product = productToObject(productArray, categoryAttributes, headers, rowNumber);
        let validationResult1 = validateRequiredAttributes(product, categoryAttributes, rowNumber);
        let errors = validationResult1.errors;
        let score1 = validationResult1.score;
        let validationResult = validateRow(product);
        let score2 = validationResult.score;
        totalrowscore += ((score1+score2)/totalscore) * 100
        if (validationResult.errors.length > 0) {
            correctnessErrors.push({ row: rowNumber, errors: validationResult.errors });
        }
        
        if (errors.length > 0) {
            validationErrors.push({ row: rowNumber, errors });
        }
    
        let flatProduct = flattenProduct(product);
        flatProduct.score = validationResult.score; 
    
        
        await insertIntoTable(tableName, flatProduct);
    }
    let catelogscore = totalrowscore/totalpossiblescore * 100
    // console.log("Total catalog score:",catelogscore) ;

    const sessionId = req.sessionID || Math.random().toString(36).substring(2, 15);
    sessionTables[sessionId] = tableName;
    res.json({
        isValid: validationErrors.length === 0 && correctnessErrors.length === 0,
        message: validationErrors.length > 0 || correctnessErrors.length > 0 ? "Validation errors found" : "File uploaded and processed successfully",
        validationErrors: validationErrors,
        correctnessErrors: correctnessErrors,
        filePath: req.file.path,
        tableName: tableName,
        sessionId: sessionId,
        catalogScore: catelogscore.toFixed(2)
    });
});
  
app.post('/submit-corrections', async (req, res) => {
    const { corrections, sessionId } = req.body;
    const tableName = sessionTables[sessionId];
    if (!tableName) {
        return res.status(400).json({ message: 'Session ID is invalid or expired.' });
    }

    const connection = await db.getConnection(); 

    try {
        await connection.beginTransaction(); 

        const headers = await getHeadersFromTable(connection, tableName);

        
        for (const correction of corrections) {
            const { cell, row, newValue } = correction;
            if (!cell || cell.length < 2) {
                console.error(`Invalid cell format: ${cell}`);
                continue;
            }
            const columnNameIndex = cell.charCodeAt(0) - 65; 
            const columnName = headers[columnNameIndex]; 

            await updateCellValue(connection, tableName, columnName, row - 1, newValue); 
        }

        await connection.commit(); 

        let correctedRows = [];
        let validityErrors = [];
        
        for (const correction of corrections) {
            const { cell, row } = correction;
            const adjustedRow = row - 1; 

            const dbData = await getProductRowFromTable(connection, tableName, adjustedRow); 
            const productForValidation = transformDbDataForValidation(dbData, headers, adjustedRow); 
            
            const validationResult = validateRow(productForValidation);
            if (validationResult.errors.length > 0) {
                validityErrors.push({ row: adjustedRow + 1, errors: validationResult.errors }); 
            } else {
                correctedRows.push({ row: adjustedRow, score: validationResult.score });
            }
        }

        for (const correctedRow of correctedRows) {
            await updateProductScore(connection, tableName, correctedRow.row, correctedRow.score);
        }
        await connection.commit(); 
        let totalscore = 0;
        let calculatedScore = 0;
        const [rows] = await connection.query(`SELECT score, main_category FROM \`${tableName}\``);
        rows.forEach(row => {
            const category = row.main_category; 
            const score = row.score;
            totalscore+=totalcategoryscore[category];
            calculatedScore += score*2;
        });

        let catalogScore = (calculatedScore/totalscore) * 100;
        // console.log(calculatedScore);
        // console.log(totalscore);
        console.log((calculatedScore/totalscore) * 100);


        let message = 'Corrections updated and validated successfully.';
        if (validityErrors.length > 0) {
            message = 'Corrections updated, but some values are still invalid.';
        }

        res.json({ 
            message: message, 
            validityErrors: validityErrors,
            catalogsScore:catalogScore.toFixed(2) 
        });
    } catch (error) {
        await connection.rollback(); 
        console.error('An error occurred while updating corrections:', error);
        res.status(500).json({ message: 'An error occurred while updating corrections.', error: error.message });
    } finally {
        connection.release(); 
    }
});




function transformDbDataForValidation(dbData, headers, rowNumber) {
    const transformed = {};
    headers.forEach((header, index) => {
        const cell = `${String.fromCharCode(65 + index)}${rowNumber}`; 
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
      throw error; 
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
        let adjustedIndex = index + 1; 
        let rawValue = productArray[adjustedIndex]; 
        let value = rawValue ? rawValue.toString().trim() : null;
        if (value === 'na' || value === '') value = null;

    
        if (header === 'Certification_Verification' || header === 'Availability') {
           
            productObject[header] = { value, cell: `${String.fromCharCode(65 + adjustedIndex - 1)}${rowNumber}` };
            return; 
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

        productObject[header] = { value, cell: `${String.fromCharCode(65 + adjustedIndex - 1)}${rowNumber}` };
    });

    return productObject;
}





function validateRequiredAttributes(product, categoryAttributes, rowNumber) {
    let errors = [];
    let score = 0;
    Object.entries(categoryAttributes).forEach(([attribute, config]) => {
        const value = product[attribute]?.value;
        const type = typeof value;
        
        if (config.required && (value === null || value === 'na')) {
            errors.push(`Missing required value for '${attribute}' in row ${rowNumber}.`);
            console.log(`Missing required value for '${attribute}' in row ${rowNumber}.`)
        } else if (config.type === 'number' && type !== 'number') {
            if (value !== null) { // Only log type mismatch if the value is not null
                errors.push(`Incorrect type for '${attribute}' in row ${rowNumber}. Expected number, got ${type}.`);
                console.log(`Incorrect type for '${attribute}' in row ${rowNumber}. Expected number, got ${type}.`)
            }
        }
        else{
            score += config.required ? 1 : 0;
        } 
    });
    return {errors, score};
}


function flattenProduct(product) {
    let flatProduct = {};
    Object.entries(product).forEach(([key, attr]) => {
        flatProduct[key] = attr.value;
    });
    return flatProduct;
}



app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});