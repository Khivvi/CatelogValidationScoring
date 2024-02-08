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
                if (isNaN(value) || value < 0) {
                    errors.push(`Invalid 'discount_price' at cell ${cell}: '${value}'. Must be a non-negative number.`);
                } else {
                    score += 10;
                }
                break;
            case 'actual_price':
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
                if (value !== 'yes' && value !== 'no') {
                    errors.push(`Invalid 'Certification_Verification' at cell ${cell}: '${value}'. Must be 'Yes' or 'No'.`);
                } else {
                    score += 10;
                }
                break;
            case 'Availability':
                if (value !== 'yes' && value !== 'no') {
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

module.exports = validateRow;